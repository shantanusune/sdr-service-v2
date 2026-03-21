#!/usr/bin/env python3
import json
import math
import struct
import time

import zmq

ENDPOINT = "tcp://127.0.0.1:5555"
DEVICE_ID = "rtl_0"
MACHINE_IP = "192.168.10.24"
CENTER = 2437000000
SAMPLE_RATE = 2560000

ctx = zmq.Context()
pub = ctx.socket(zmq.PUB)
pub.setsockopt(zmq.SNDHWM, 200)
pub.bind(ENDPOINT)

seq = 0
phase = 0.0


def send(topic: str, payload: bytes):
    pub.send_string(topic, zmq.SNDMORE)
    pub.send(payload)


def send_meta_once():
    send("meta/host", json.dumps({
        "hostname": "sdr-v2-sim",
        "machineIp": MACHINE_IP,
        "os": "macOS",
        "arch": "arm64",
        "pid": 9999
    }).encode())

    send("meta/topics", json.dumps({
        "publish": [f"{DEVICE_ID}/rawfeed", "meta/host", "meta/service", "meta/devices", "meta/topics", "meta/usb"],
        "subscribe": [f"control/{DEVICE_ID}/rawfeed", f"control/{DEVICE_ID}/spectrum"],
        "pub": [f"{DEVICE_ID}/rawfeed", "meta/host", "meta/service", "meta/devices", "meta/topics", "meta/usb"],
        "sub": [f"control/{DEVICE_ID}/rawfeed", f"control/{DEVICE_ID}/spectrum"]
    }).encode())


def send_meta_periodic():
    send("meta/service", json.dumps({
        "service": "native_sdr_v2",
        "status": "RUNNING",
        "version": "0.1.0",
        "tsNs": time.time_ns()
    }).encode())

    send("meta/devices", json.dumps({
        "connected": [
            {
                "id": DEVICE_ID,
                "type": "RTLSDR",
                "capabilities": {
                    "minFreqHz": 1000000,
                    "maxFreqHz": 6000000000,
                    "maxSampleRateHz": 20000000,
                },
                "caps": {
                    "minHz": 1000000,
                    "maxHz": 6000000000,
                    "bwHz": 20000000,
                },
                "state": {
                    "open": True,
                    "rxRunning": True,
                    "rx": True,
                    "centerFreqHz": CENTER,
                    "centerHz": CENTER,
                    "sampleRateHz": SAMPLE_RATE,
                    "srHz": SAMPLE_RATE,
                },
            }
        ]
    }).encode())


def make_raw_frame():
    global seq, phase
    pairs = 4096
    iq = bytearray(pairs * 2)
    for i in range(pairs):
        t = phase + i * 0.03
        i_val = int((math.sin(t) * 0.45 + 0.5) * 255)
        q_val = int((math.cos(t * 1.2) * 0.45 + 0.5) * 255)
        iq[2 * i] = max(0, min(255, i_val))
        iq[2 * i + 1] = max(0, min(255, q_val))
    phase += 0.2

    header = struct.pack(
        "<4sBBHQIQQIBBHI",
        b"RDSD",  # magic
        1,  # version
        0,  # device type RTLSDR
        0,  # flags
        CENTER,
        SAMPLE_RATE,
        time.time_ns(),
        seq,
        len(iq),
        0,  # iq format U8
        0,
        0,
        0,
    )
    seq += 1
    return header + bytes(iq)


if __name__ == "__main__":
    print(f"simulator publishing on {ENDPOINT}")
    # Allow subscribers to connect
    time.sleep(0.7)
    send_meta_once()

    next_meta = 0.0
    while True:
        now = time.time()
        if now >= next_meta:
            send_meta_periodic()
            next_meta = now + 2.0

        send(f"{DEVICE_ID}/rawfeed", make_raw_frame())
        time.sleep(0.05)
