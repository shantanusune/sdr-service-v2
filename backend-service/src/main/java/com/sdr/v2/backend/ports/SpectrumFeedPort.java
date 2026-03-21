package com.sdr.v2.backend.ports;

import com.sdr.v2.backend.domain.SpectrumFrame;

public interface SpectrumFeedPort {
    void publish(SpectrumFrame frame);
}
