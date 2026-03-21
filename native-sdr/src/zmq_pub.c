#include "sdrv2/zmq_pub.h"

#include <pthread.h>
#include <stdlib.h>
#include <string.h>
#include <zmq.h>

struct sdr_zmq_publisher {
  void* ctx;
  void* pub;
  pthread_mutex_t lock;
};

sdr_zmq_publisher_t* sdr_zmq_publisher_create(const char* endpoint) {
  sdr_zmq_publisher_t* p = (sdr_zmq_publisher_t*)calloc(1, sizeof(*p));
  if (!p) return NULL;

  p->ctx = zmq_ctx_new();
  if (!p->ctx) {
    free(p);
    return NULL;
  }

  p->pub = zmq_socket(p->ctx, ZMQ_PUB);
  if (!p->pub) {
    zmq_ctx_term(p->ctx);
    free(p);
    return NULL;
  }

  pthread_mutex_init(&p->lock, NULL);

  int sndhwm = 200;
  zmq_setsockopt(p->pub, ZMQ_SNDHWM, &sndhwm, sizeof(sndhwm));

  if (zmq_bind(p->pub, endpoint) != 0) {
    sdr_zmq_publisher_destroy(p);
    return NULL;
  }

  return p;
}

void sdr_zmq_publisher_destroy(sdr_zmq_publisher_t* pub) {
  if (!pub) return;
  pthread_mutex_lock(&pub->lock);
  if (pub->pub) {
    zmq_close(pub->pub);
    pub->pub = NULL;
  }
  if (pub->ctx) {
    zmq_ctx_term(pub->ctx);
    pub->ctx = NULL;
  }
  pthread_mutex_unlock(&pub->lock);
  pthread_mutex_destroy(&pub->lock);
  free(pub);
}

int sdr_zmq_publish(sdr_zmq_publisher_t* pub, const char* topic, const uint8_t* data, size_t len) {
  if (!pub || !pub->pub || !topic || !data) return -1;

  pthread_mutex_lock(&pub->lock);

  zmq_msg_t tmsg;
  zmq_msg_init_size(&tmsg, strlen(topic));
  memcpy(zmq_msg_data(&tmsg), topic, strlen(topic));
  if (zmq_msg_send(&tmsg, pub->pub, ZMQ_SNDMORE) < 0) {
    zmq_msg_close(&tmsg);
    pthread_mutex_unlock(&pub->lock);
    return -1;
  }
  zmq_msg_close(&tmsg);

  zmq_msg_t msg;
  zmq_msg_init_size(&msg, len);
  memcpy(zmq_msg_data(&msg), data, len);
  int rc = zmq_msg_send(&msg, pub->pub, 0);
  zmq_msg_close(&msg);

  pthread_mutex_unlock(&pub->lock);
  return (rc >= 0) ? 0 : -1;
}
