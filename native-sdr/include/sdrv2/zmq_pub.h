#ifndef SDRV2_ZMQ_PUB_H
#define SDRV2_ZMQ_PUB_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct sdr_zmq_publisher sdr_zmq_publisher_t;

sdr_zmq_publisher_t* sdr_zmq_publisher_create(const char* endpoint);
void sdr_zmq_publisher_destroy(sdr_zmq_publisher_t* pub);
int sdr_zmq_publish(sdr_zmq_publisher_t* pub, const char* topic, const uint8_t* data, size_t len);

#ifdef __cplusplus
}
#endif

#endif
