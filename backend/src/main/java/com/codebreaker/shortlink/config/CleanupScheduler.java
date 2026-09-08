package com.codebreaker.shortlink.config;

import com.codebreaker.shortlink.services.UrlShortnerServices;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;


@Component
@RequiredArgsConstructor
@Slf4j

public class CleanupScheduler {

    private final UrlShortnerServices urlShortnerServices;


    @Scheduled(fixedRateString = "#{${shortlink.cleanup.interval-minutes} * 60 * 100}")
    public void cleanupExpiredUrls() {

        try {
            log.debug("Running scheduled cleanup of expeired urls");
            urlShortnerServices.cleanUpExpeiredUrl();

        } catch (Exception e) {
            log.error("Error durin scheduled cleanup", e);
        }


    }
}
