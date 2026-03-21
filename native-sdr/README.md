# native-sdr

Native C SDR capture service that publishes ZMQ frames and metadata.

## Responsibilities

- Read IQ from hardware radios (RTL-SDR/HackRF)
- Publish raw IQ frames with stable `RDSD` 48-byte header
- Publish native activity metadata topics:
  - `meta/host`
  - `meta/service`
  - `meta/devices`
  - `meta/topics`

## Topics

- `<deviceId>/rawfeed` binary payload: `[RDSD header][IQ bytes]`

## Build

```bash
mkdir -p build
cd build
cmake ..
cmake --build . -j
```

## Run

```bash
./native_sdr --driver rtl --device-id rtl_0 --index 0 --freq 2400000000 --sr 2560000 --zmq tcp://127.0.0.1:5555
```

HackRF example:

```bash
./native_sdr --driver hackrf --device-id hackrf_0 --freq 2400000000 --sr 10000000 --zmq tcp://127.0.0.1:5555
```
