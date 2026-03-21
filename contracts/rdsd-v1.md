# RDSD v1 Contract

This contract defines the ZeroMQ topics and binary frame format used between `native-sdr` and `backend-service`.

## Transport

- ZeroMQ PUB/SUB
- Publisher: `native-sdr`
- Subscriber: `backend-service`
- Default endpoint: `tcp://127.0.0.1:5555`

## Topics

### Raw IQ stream

- Topic format: `<deviceId>/rawfeed`
- Message frame: `[48-byte RDSD header][IQ payload bytes]`

### Metadata topics

- `meta/host`: host identity (`hostname`, `machineIp`, `os`, `arch`, `pid`)
- `meta/service`: native service heartbeat (`service`, `status`, `version`, `tsNs`)
- `meta/devices`: connected SDR list and runtime state (`full=true` means complete snapshot for host)
- `meta/usb`: USB attach/detach events (`event`, `deviceId`, `driver`, optional `usb`/`serial`, `tsNs`)
- `meta/topics`: publish/subscribe topic catalog

## RDSD Header (48 bytes, little-endian)

1. `magic` (`char[4]`) = `RDSD`
2. `version` (`u8`) = `1`
3. `device_type` (`u8`) = `0=RTLSDR`, `1=HACKRF`
4. `flags` (`u16`)
5. `center_freq_hz` (`u64`)
6. `sample_rate_hz` (`u32`)
7. `timestamp_ns` (`u64`) monotonic timestamp from native process
8. `seq` (`u64`) per-device sequence
9. `payload_len` (`u32`) length of IQ payload following header
10. `iq_format` (`u8`) `0=U8 IQ`, `1=S8 IQ`, `2=F32 bins` (reserved for future)
11. `reserved0` (`u8`)
12. `reserved1` (`u16`)
13. `reserved2` (`u32`)

## Processing Rules

- Detection pipeline must consume raw IQ (`rawfeed`) only.
- FFT/live spectrum must be derived in backend from IQ frames.
- Metadata topics must update online/offline/health views, not replace IQ payload for detection.
- `meta/usb` attach/detach must drive device register/unregister state transitions in registry.
- Consumers must ignore unknown topics and unknown future header flags.

## Compatibility

- Backward compatibility key: `magic + version`.
- Any breaking layout change must increment `version` and be documented as a new contract (`rdsd-v2.md`).
