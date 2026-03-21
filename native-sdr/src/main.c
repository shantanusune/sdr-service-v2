#include "sdrv2/device.h"
#include "sdrv2/frame.h"
#include "sdrv2/zmq_pub.h"

#include <arpa/inet.h>
#include <ifaddrs.h>
#include <net/if.h>
#include <signal.h>
#include <stdatomic.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/utsname.h>
#include <time.h>
#include <unistd.h>

typedef struct {
  sdr_zmq_publisher_t* pub;
  sdr_device_config_t cfg;
  atomic_ullong seq;
} app_ctx_t;

static atomic_int g_stop = 0;
static atomic_int g_cleanup_done = 0;
static app_ctx_t* g_cleanup_ctx = NULL;
static sdr_device_handle_t* g_cleanup_handle = NULL;
static sdr_zmq_publisher_t* g_cleanup_pub = NULL;
static const int g_start_retry_delay_ms = 2000;
static const uint64_t g_heartbeat_interval_ns = 5000000000ULL;

static uint64_t now_monotonic_ns(void) {
  struct timespec ts;
  clock_gettime(CLOCK_MONOTONIC, &ts);
  return (uint64_t)ts.tv_sec * 1000000000ULL + (uint64_t)ts.tv_nsec;
}

static const char* first_non_loopback_ipv4(void) {
  static char ip[64] = "127.0.0.1";
  struct ifaddrs* ifaddr = NULL;
  if (getifaddrs(&ifaddr) != 0 || !ifaddr) {
    return ip;
  }

  for (struct ifaddrs* ifa = ifaddr; ifa != NULL; ifa = ifa->ifa_next) {
    if (!ifa->ifa_addr) continue;
    if (ifa->ifa_addr->sa_family != AF_INET) continue;
    if (ifa->ifa_flags & IFF_LOOPBACK) continue;
    struct sockaddr_in* sa = (struct sockaddr_in*)ifa->ifa_addr;
    const char* ret = inet_ntop(AF_INET, &sa->sin_addr, ip, sizeof(ip));
    if (ret) break;
  }

  freeifaddrs(ifaddr);
  return ip;
}

static void publish_json(sdr_zmq_publisher_t* pub, const char* topic, const char* json) {
  sdr_zmq_publish(pub, topic, (const uint8_t*)json, strlen(json));
}

static void publish_host_meta(app_ctx_t* ctx) {
  char host[128] = "unknown";
  gethostname(host, sizeof(host) - 1);
  struct utsname un;
  uname(&un);

  char json[512];
  snprintf(json, sizeof(json),
           "{\"hostname\":\"%s\",\"machineIp\":\"%s\",\"os\":\"%s\",\"arch\":\"%s\",\"pid\":%d}",
           host, first_non_loopback_ipv4(), un.sysname, un.machine, getpid());
  publish_json(ctx->pub, "meta/host", json);
}

static void publish_service_meta(app_ctx_t* ctx, const char* status) {
  char json[512];
  snprintf(json, sizeof(json),
           "{\"service\":\"native_sdr_v2\",\"status\":\"%s\",\"version\":\"0.1.0\",\"tsNs\":%llu}",
           status,
           (unsigned long long)now_monotonic_ns());
  publish_json(ctx->pub, "meta/service", json);
}

static void publish_devices_meta(app_ctx_t* ctx, const char* status, int connected) {
  const char* type = (ctx->cfg.driver == SDR_DRIVER_HACKRF) ? "HACKRF" : "RTLSDR";
  char json[1024];
  if (connected) {
    snprintf(json, sizeof(json),
             "{\"full\":true,\"connected\":[{\"id\":\"%s\",\"type\":\"%s\",\"usb\":{\"serial\":\"%s\"},\"capabilities\":{\"minFreqHz\":1000000,\"maxFreqHz\":6000000000,\"maxSampleRateHz\":20000000},\"caps\":{\"minHz\":1000000,\"maxHz\":6000000000,\"bwHz\":20000000},\"state\":{\"open\":true,\"rxRunning\":%s,\"rx\":%s,\"centerFreqHz\":%llu,\"centerHz\":%llu,\"sampleRateHz\":%u,\"srHz\":%u,\"status\":\"%s\"}}]}",
             ctx->cfg.device_id,
             type,
             ctx->cfg.serial,
             (strcmp(status, "RUNNING") == 0) ? "true" : "false",
             (strcmp(status, "RUNNING") == 0) ? "true" : "false",
             (unsigned long long)ctx->cfg.center_freq_hz,
             (unsigned long long)ctx->cfg.center_freq_hz,
             ctx->cfg.sample_rate_hz,
             ctx->cfg.sample_rate_hz,
             status);
  } else {
    snprintf(json, sizeof(json),
             "{\"full\":true,\"connected\":[]}");
  }
  publish_json(ctx->pub, "meta/devices", json);
}

static void sanitize_json_string(char* out, size_t out_len, const char* in) {
  if (!out || out_len == 0) {
    return;
  }
  if (!in) {
    out[0] = '\0';
    return;
  }

  size_t j = 0;
  for (size_t i = 0; in[i] != '\0' && j + 1 < out_len; i++) {
    unsigned char c = (unsigned char)in[i];
    if (c < 0x20 || c == '"' || c == '\\') {
      out[j++] = ' ';
      continue;
    }
    out[j++] = (char)c;
  }
  out[j] = '\0';
}

static void publish_usb_meta(app_ctx_t* ctx, const char* event, const char* detail) {
  const char* driver = (ctx->cfg.driver == SDR_DRIVER_HACKRF) ? "hackrf" : "rtl";
  unsigned int vendor_id = (ctx->cfg.driver == SDR_DRIVER_HACKRF) ? 0x1d50U : 0x0bdaU;
  unsigned int product_id = (ctx->cfg.driver == SDR_DRIVER_HACKRF) ? 0x6089U : 0x2838U;
  char safe_detail[192];
  sanitize_json_string(safe_detail, sizeof(safe_detail), detail);

  char json[1024];
  if (safe_detail[0] != '\0') {
    snprintf(json, sizeof(json),
             "{\"event\":\"%s\",\"deviceId\":\"%s\",\"driver\":\"%s\",\"index\":%d,\"serial\":\"%s\",\"usb\":{\"vendorId\":\"%04x\",\"productId\":\"%04x\",\"serial\":\"%s\"},\"detail\":\"%s\",\"tsNs\":%llu}",
             event,
             ctx->cfg.device_id,
             driver,
             ctx->cfg.index,
             ctx->cfg.serial,
             vendor_id,
             product_id,
             ctx->cfg.serial,
             safe_detail,
             (unsigned long long)now_monotonic_ns());
  } else {
    snprintf(json, sizeof(json),
             "{\"event\":\"%s\",\"deviceId\":\"%s\",\"driver\":\"%s\",\"index\":%d,\"serial\":\"%s\",\"usb\":{\"vendorId\":\"%04x\",\"productId\":\"%04x\",\"serial\":\"%s\"},\"tsNs\":%llu}",
             event,
             ctx->cfg.device_id,
             driver,
             ctx->cfg.index,
             ctx->cfg.serial,
             vendor_id,
             product_id,
             ctx->cfg.serial,
             (unsigned long long)now_monotonic_ns());
  }
  publish_json(ctx->pub, "meta/usb", json);
}

static void publish_topics_meta(app_ctx_t* ctx) {
  char json[1024];
  snprintf(json, sizeof(json),
           "{\"publish\":[\"%s/rawfeed\",\"meta/host\",\"meta/service\",\"meta/devices\",\"meta/topics\",\"meta/usb\"],\"subscribe\":[\"control/%s/rawfeed\",\"control/%s/spectrum\"],\"pub\":[\"%s/rawfeed\",\"meta/host\",\"meta/service\",\"meta/devices\",\"meta/topics\",\"meta/usb\"],\"sub\":[\"control/%s/rawfeed\",\"control/%s/spectrum\"]}",
           ctx->cfg.device_id,
           ctx->cfg.device_id,
           ctx->cfg.device_id,
           ctx->cfg.device_id,
           ctx->cfg.device_id,
           ctx->cfg.device_id);
  publish_json(ctx->pub, "meta/topics", json);
}

static void on_samples(const uint8_t* data,
                       size_t len,
                       uint64_t center_freq_hz,
                       uint32_t sample_rate_hz,
                       uint8_t iq_format,
                       void* user) {
  app_ctx_t* ctx = (app_ctx_t*)user;
  if (!ctx || !ctx->pub || !data || len == 0) return;

  sdr_frame_header_t hdr;
  memset(&hdr, 0, sizeof(hdr));
  sdrv2_fill_magic(&hdr);
  hdr.version = 1;
  hdr.device_type = (ctx->cfg.driver == SDR_DRIVER_HACKRF) ? 1 : 0;
  hdr.flags = 0;
  hdr.center_freq_hz = center_freq_hz;
  hdr.sample_rate_hz = sample_rate_hz;
  hdr.timestamp_ns = now_monotonic_ns();
  hdr.seq = atomic_fetch_add(&ctx->seq, 1);
  hdr.payload_len = (uint32_t)len;
  hdr.iq_format = iq_format;

  size_t frame_len = sizeof(hdr) + len;
  uint8_t* frame = (uint8_t*)malloc(frame_len);
  if (!frame) return;

  memcpy(frame, &hdr, sizeof(hdr));
  memcpy(frame + sizeof(hdr), data, len);

  char topic[128];
  snprintf(topic, sizeof(topic), "%s/rawfeed", ctx->cfg.device_id);
  sdr_zmq_publish(ctx->pub, topic, frame, frame_len);

  free(frame);
}

static void on_signal(int sig) {
  (void)sig;
  atomic_store(&g_stop, 1);
}

static void install_signal_handlers(void) {
  struct sigaction sa;
  memset(&sa, 0, sizeof(sa));
  sa.sa_handler = on_signal;
  sigemptyset(&sa.sa_mask);

  sigaction(SIGINT, &sa, NULL);
  sigaction(SIGTERM, &sa, NULL);
  sigaction(SIGHUP, &sa, NULL);
  sigaction(SIGQUIT, &sa, NULL);
}

static void cleanup_runtime(void) {
  if (atomic_exchange(&g_cleanup_done, 1) != 0) {
    return;
  }

  if (g_cleanup_ctx && g_cleanup_pub) {
    publish_service_meta(g_cleanup_ctx, "STOPPED");
    publish_devices_meta(g_cleanup_ctx, "STOPPED", 0);
  }

  if (g_cleanup_handle) {
    sdr_device_stop(g_cleanup_handle);
    g_cleanup_handle = NULL;
  }

  if (g_cleanup_pub) {
    sdr_zmq_publisher_destroy(g_cleanup_pub);
    g_cleanup_pub = NULL;
  }

  if (g_cleanup_ctx) {
    g_cleanup_ctx->pub = NULL;
  }
}

static void sleep_interruptible_ms(int total_ms) {
  if (total_ms <= 0) {
    return;
  }

  int remaining = total_ms;
  while (remaining > 0 && !atomic_load(&g_stop)) {
    int chunk = remaining > 100 ? 100 : remaining;
    usleep((useconds_t)chunk * 1000U);
    remaining -= chunk;
  }
}

static void usage(const char* prog) {
  fprintf(stderr,
          "Usage: %s [--driver rtl|hackrf] [--device-id id] [--index n] [--serial s] [--freq hz] [--sr hz] [--gain db] [--zmq endpoint] [--hard-reset-on-stop]\n",
          prog);
}

int main(int argc, char** argv) {
  sdr_device_config_t cfg;
  memset(&cfg, 0, sizeof(cfg));
  cfg.driver = SDR_DRIVER_RTLSDR;
  cfg.index = 0;
  cfg.sample_rate_hz = 2560000;
  cfg.center_freq_hz = 2400000000ULL;
  cfg.gain_db = 0;
  cfg.hackrf_reset_on_stop = 0;
  snprintf(cfg.device_id, sizeof(cfg.device_id), "rtl_0");

  char zmq_endpoint[128] = "tcp://127.0.0.1:5555";

  for (int i = 1; i < argc; i++) {
    if (strcmp(argv[i], "--driver") == 0 && i + 1 < argc) {
      i++;
      if (strcmp(argv[i], "hackrf") == 0) cfg.driver = SDR_DRIVER_HACKRF;
      else cfg.driver = SDR_DRIVER_RTLSDR;
    } else if (strcmp(argv[i], "--device-id") == 0 && i + 1 < argc) {
      i++;
      snprintf(cfg.device_id, sizeof(cfg.device_id), "%s", argv[i]);
    } else if (strcmp(argv[i], "--index") == 0 && i + 1 < argc) {
      cfg.index = atoi(argv[++i]);
    } else if (strcmp(argv[i], "--serial") == 0 && i + 1 < argc) {
      snprintf(cfg.serial, sizeof(cfg.serial), "%s", argv[++i]);
    } else if (strcmp(argv[i], "--freq") == 0 && i + 1 < argc) {
      cfg.center_freq_hz = (uint64_t)strtoull(argv[++i], NULL, 10);
    } else if (strcmp(argv[i], "--sr") == 0 && i + 1 < argc) {
      cfg.sample_rate_hz = (uint32_t)strtoul(argv[++i], NULL, 10);
    } else if (strcmp(argv[i], "--gain") == 0 && i + 1 < argc) {
      cfg.gain_db = atoi(argv[++i]);
    } else if (strcmp(argv[i], "--zmq") == 0 && i + 1 < argc) {
      snprintf(zmq_endpoint, sizeof(zmq_endpoint), "%s", argv[++i]);
    } else if (strcmp(argv[i], "--hard-reset-on-stop") == 0) {
      cfg.hackrf_reset_on_stop = 1;
    } else {
      usage(argv[0]);
      return 2;
    }
  }

  install_signal_handlers();
  (void)atexit(cleanup_runtime);

  sdr_zmq_publisher_t* pub = sdr_zmq_publisher_create(zmq_endpoint);
  if (!pub) {
    fprintf(stderr, "failed to create zmq publisher on %s\n", zmq_endpoint);
    return 1;
  }

  app_ctx_t ctx;
  memset(&ctx, 0, sizeof(ctx));
  ctx.pub = pub;
  ctx.cfg = cfg;
  atomic_init(&ctx.seq, 0ULL);
  g_cleanup_ctx = &ctx;
  g_cleanup_pub = pub;

  publish_host_meta(&ctx);
  publish_topics_meta(&ctx);
  publish_service_meta(&ctx, "STARTING");
  publish_devices_meta(&ctx, "STARTING", 0);

  sdr_device_handle_t* handle = NULL;
  int usb_presence = 0;  // 0=unknown, 1=attached, 2=detached
  uint64_t next_heartbeat_ns = 0;

  while (!atomic_load(&g_stop)) {
    if (!handle) {
      sdr_device_handle_t* started = NULL;
      if (sdr_device_start(&cfg, on_samples, &ctx, &started) == 0 && started != NULL) {
        handle = started;
        g_cleanup_handle = handle;
        if (usb_presence != 1) {
          publish_usb_meta(&ctx, "ATTACHED", "device stream opened");
          usb_presence = 1;
        }
        publish_service_meta(&ctx, "RUNNING");
        publish_devices_meta(&ctx, "RUNNING", 1);
        next_heartbeat_ns = now_monotonic_ns() + g_heartbeat_interval_ns;
        fprintf(stdout, "native_sdr started driver=%s device=%s zmq=%s\n",
                (cfg.driver == SDR_DRIVER_HACKRF) ? "hackrf" : "rtl",
                cfg.device_id,
                zmq_endpoint);
        continue;
      }

      const char* err = sdr_device_last_error();
      fprintf(stderr,
              "device start failed: %s (retrying in %d ms)\n",
              err,
              g_start_retry_delay_ms);
      if (usb_presence != 2) {
        publish_usb_meta(&ctx, "DETACHED", err);
        usb_presence = 2;
      }
      publish_service_meta(&ctx, "RECONNECTING");
      publish_devices_meta(&ctx, "STOPPED", 0);
      sleep_interruptible_ms(g_start_retry_delay_ms);
      continue;
    }

    if (!sdr_device_is_running(handle)) {
      const char* err = sdr_device_last_error();
      fprintf(stderr, "device stream stopped: %s\n", err);
      sdr_device_stop(handle);
      handle = NULL;
      g_cleanup_handle = NULL;
      if (usb_presence != 2) {
        publish_usb_meta(&ctx, "DETACHED", err);
        usb_presence = 2;
      }
      publish_service_meta(&ctx, "RECONNECTING");
      publish_devices_meta(&ctx, "STOPPED", 0);
      sleep_interruptible_ms(g_start_retry_delay_ms);
      continue;
    }

    uint64_t now_ns = now_monotonic_ns();
    if (next_heartbeat_ns == 0 || now_ns >= next_heartbeat_ns) {
      publish_service_meta(&ctx, "RUNNING");
      publish_devices_meta(&ctx, "RUNNING", 1);
      next_heartbeat_ns = now_ns + g_heartbeat_interval_ns;
    }
    sleep_interruptible_ms(250);
  }

  cleanup_runtime();

  return 0;
}
