#include "sdrv2/device.h"

#include <pthread.h>
#include <stdatomic.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef HAVE_RTLSDR
#include <rtl-sdr.h>
#endif

#ifdef HAVE_HACKRF
#include <libhackrf/hackrf.h>
#endif

static char g_last_error[256];

static void set_error(const char* msg) {
  snprintf(g_last_error, sizeof(g_last_error), "%s", msg ? msg : "unknown error");
}

const char* sdr_device_last_error(void) {
  return g_last_error;
}

struct sdr_device_handle {
  const sdr_device_config_t* cfg;
  sdr_samples_cb cb;
  void* user;
  atomic_int running;
#ifdef HAVE_RTLSDR
  rtlsdr_dev_t* rtl;
  pthread_t rtl_thread;
#endif
#ifdef HAVE_HACKRF
  hackrf_device* hackrf;
#endif
};

#ifdef HAVE_RTLSDR
static void rtlsdr_cb(unsigned char* buf, uint32_t len, void* ctx) {
  sdr_device_handle_t* h = (sdr_device_handle_t*)ctx;
  if (!h || !buf || len == 0) return;
  h->cb(buf, len, h->cfg->center_freq_hz, h->cfg->sample_rate_hz, 0, h->user);
}

static void* rtlsdr_thread_main(void* arg) {
  sdr_device_handle_t* h = (sdr_device_handle_t*)arg;
  rtlsdr_reset_buffer(h->rtl);
  rtlsdr_read_async(h->rtl, rtlsdr_cb, h, 0, 262144);
  return NULL;
}
#endif

#ifdef HAVE_HACKRF
static int hackrf_cb(hackrf_transfer* transfer) {
  sdr_device_handle_t* h = (sdr_device_handle_t*)transfer->rx_ctx;
  if (!h || !transfer || !transfer->buffer || transfer->valid_length <= 0) return 0;
  h->cb((uint8_t*)transfer->buffer,
        (size_t)transfer->valid_length,
        h->cfg->center_freq_hz,
        h->cfg->sample_rate_hz,
        1,
        h->user);
  return 0;
}
#endif

int sdr_device_start(const sdr_device_config_t* cfg,
                     sdr_samples_cb cb,
                     void* user,
                     sdr_device_handle_t** out) {
  if (!cfg || !cb || !out) {
    set_error("invalid args");
    return -1;
  }

  sdr_device_handle_t* h = (sdr_device_handle_t*)calloc(1, sizeof(*h));
  if (!h) {
    set_error("alloc failed");
    return -1;
  }

  h->cfg = cfg;
  h->cb = cb;
  h->user = user;
  atomic_store(&h->running, 1);

  if (cfg->driver == SDR_DRIVER_RTLSDR) {
#ifdef HAVE_RTLSDR
    if (rtlsdr_open(&h->rtl, (uint32_t)cfg->index) != 0) {
      set_error("rtlsdr_open failed");
      free(h);
      return -1;
    }
    rtlsdr_set_sample_rate(h->rtl, cfg->sample_rate_hz);
    rtlsdr_set_center_freq(h->rtl, (uint32_t)cfg->center_freq_hz);
    if (cfg->gain_db > 0) {
      rtlsdr_set_tuner_gain_mode(h->rtl, 1);
      rtlsdr_set_tuner_gain(h->rtl, cfg->gain_db * 10);
    } else {
      rtlsdr_set_tuner_gain_mode(h->rtl, 0);
    }
    if (pthread_create(&h->rtl_thread, NULL, rtlsdr_thread_main, h) != 0) {
      rtlsdr_close(h->rtl);
      set_error("rtl thread create failed");
      free(h);
      return -1;
    }
#else
    set_error("RTL-SDR support not compiled (install librtlsdr-dev)");
    free(h);
    return -1;
#endif
  } else {
#ifdef HAVE_HACKRF
    if (hackrf_init() != HACKRF_SUCCESS) {
      set_error("hackrf_init failed");
      free(h);
      return -1;
    }
    int rc;
    if (cfg->serial[0] != '\0') {
      rc = hackrf_open_by_serial(cfg->serial, &h->hackrf);
    } else {
      rc = hackrf_open(&h->hackrf);
    }
    if (rc != HACKRF_SUCCESS) {
      hackrf_exit();
      set_error("hackrf_open failed");
      free(h);
      return -1;
    }

    hackrf_set_sample_rate(h->hackrf, (double)cfg->sample_rate_hz);
    hackrf_set_freq(h->hackrf, cfg->center_freq_hz);
    if (cfg->gain_db > 0) {
      int vga = cfg->gain_db;
      if (vga < 0) vga = 0;
      if (vga > 62) vga = 62;
      hackrf_set_vga_gain(h->hackrf, (uint32_t)vga);
    }

    if (hackrf_start_rx(h->hackrf, hackrf_cb, h) != HACKRF_SUCCESS) {
      hackrf_close(h->hackrf);
      hackrf_exit();
      set_error("hackrf_start_rx failed");
      free(h);
      return -1;
    }
#else
    set_error("HackRF support not compiled (install libhackrf-dev)");
    free(h);
    return -1;
#endif
  }

  *out = h;
  return 0;
}

void sdr_device_stop(sdr_device_handle_t* h) {
  if (!h) return;

  atomic_store(&h->running, 0);

  if (h->cfg->driver == SDR_DRIVER_RTLSDR) {
#ifdef HAVE_RTLSDR
    if (h->rtl) {
      rtlsdr_cancel_async(h->rtl);
      pthread_join(h->rtl_thread, NULL);
      rtlsdr_close(h->rtl);
      h->rtl = NULL;
    }
#endif
  } else {
#ifdef HAVE_HACKRF
    if (h->hackrf) {
      hackrf_stop_rx(h->hackrf);
      hackrf_close(h->hackrf);
      h->hackrf = NULL;
      hackrf_exit();
    }
#endif
  }

  free(h);
}
