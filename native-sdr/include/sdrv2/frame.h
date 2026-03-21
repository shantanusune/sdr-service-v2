#ifndef SDRV2_FRAME_H
#define SDRV2_FRAME_H

#include <stdint.h>

#pragma pack(push, 1)
typedef struct {
  char magic[4];
  uint8_t version;
  uint8_t device_type;
  uint16_t flags;
  uint64_t center_freq_hz;
  uint32_t sample_rate_hz;
  uint64_t timestamp_ns;
  uint64_t seq;
  uint32_t payload_len;
  uint8_t iq_format; /* 0=U8 IQ, 1=S8 IQ, 2=F32 bins */
  uint8_t reserved0;
  uint16_t reserved1;
  uint32_t reserved2;
} sdr_frame_header_t;
#pragma pack(pop)

#define SDRV2_HEADER_SIZE 48

static inline void sdrv2_fill_magic(sdr_frame_header_t* h) {
  h->magic[0] = 'R';
  h->magic[1] = 'D';
  h->magic[2] = 'S';
  h->magic[3] = 'D';
}

#endif
