#ifndef SDRV2_DEVICE_H
#define SDRV2_DEVICE_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
  SDR_DRIVER_RTLSDR = 0,
  SDR_DRIVER_HACKRF = 1
} sdr_driver_t;

typedef struct {
  sdr_driver_t driver;
  int index;
  char serial[128];
  char device_id[64];
  uint32_t sample_rate_hz;
  uint64_t center_freq_hz;
  int gain_db;
} sdr_device_config_t;

typedef void (*sdr_samples_cb)(const uint8_t* data,
                               size_t len,
                               uint64_t center_freq_hz,
                               uint32_t sample_rate_hz,
                               uint8_t iq_format,
                               void* user);

typedef struct sdr_device_handle sdr_device_handle_t;

int sdr_device_start(const sdr_device_config_t* cfg,
                     sdr_samples_cb cb,
                     void* user,
                     sdr_device_handle_t** out);

void sdr_device_stop(sdr_device_handle_t* h);
const char* sdr_device_last_error(void);

#ifdef __cplusplus
}
#endif

#endif
