package com.sdr.v2.backend.infrastructure.security;

import com.sdr.v2.backend.config.AppProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;

@Configuration
public class SecurityConfig {

    @Bean
    SecurityFilterChain securityFilterChain(HttpSecurity http, AppProperties props) throws Exception {
        http
                .csrf(csrf -> csrf.disable())
                .sessionManagement(sm -> sm.sessionCreationPolicy(SessionCreationPolicy.STATELESS));

        if (props.getSecurity().isAuthEnabled()) {
            http
                    .authorizeHttpRequests(auth -> auth
                            .requestMatchers(
                                    "/health",
                                    "/actuator/health",
                                    "/actuator/info",
                                    "/ws/**"
                            ).permitAll()
                            .requestMatchers("/api/**").authenticated()
                            .anyRequest().permitAll()
                    )
                    .oauth2ResourceServer(oauth2 -> oauth2.jwt(Customizer.withDefaults()));
        } else {
            http.authorizeHttpRequests(auth -> auth.anyRequest().permitAll());
        }

        return http.build();
    }
}
