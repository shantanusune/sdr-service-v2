cmake_minimum_required(VERSION 3.16)
project(native_sdr_v2 C)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)

find_path(ZMQ_INCLUDE_DIR zmq.h)
find_library(ZMQ_LIBRARY NAMES zmq libzmq)
if(NOT ZMQ_INCLUDE_DIR OR NOT ZMQ_LIBRARY)
  message(FATAL_ERROR "ZeroMQ not found. Install libzmq3-dev (or equivalent).")
endif()

find_path(RTLSDR_INCLUDE_DIR rtl-sdr.h)
find_library(RTLSDR_LIBRARY NAMES rtlsdr)

find_path(HACKRF_INCLUDE_DIR libhackrf/hackrf.h)
find_library(HACKRF_LIBRARY NAMES hackrf)

add_executable(native_sdr
  src/main.c
  src/device.c
  src/zmq_pub.c
)

target_include_directories(native_sdr PRIVATE
  ${ZMQ_INCLUDE_DIR}
  ${CMAKE_CURRENT_SOURCE_DIR}/include
)

target_link_libraries(native_sdr PRIVATE ${ZMQ_LIBRARY} pthread)

if(RTLSDR_INCLUDE_DIR AND RTLSDR_LIBRARY)
  target_compile_definitions(native_sdr PRIVATE HAVE_RTLSDR=1)
  target_include_directories(native_sdr PRIVATE ${RTLSDR_INCLUDE_DIR})
  target_link_libraries(native_sdr PRIVATE ${RTLSDR_LIBRARY})
endif()

if(HACKRF_INCLUDE_DIR AND HACKRF_LIBRARY)
  target_compile_definitions(native_sdr PRIVATE HAVE_HACKRF=1)
  target_include_directories(native_sdr PRIVATE ${HACKRF_INCLUDE_DIR})
  target_link_libraries(native_sdr PRIVATE ${HACKRF_LIBRARY})
endif()
