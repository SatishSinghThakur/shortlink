package com.codebreaker.shortlink.services;

import com.codebreaker.shortlink.dto.ShortenUrlRequest;
import com.codebreaker.shortlink.dto.shortenUrlResponse;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.MockedStatic;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.LocalDateTime;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.mockito.Mockito.mockStatic;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class UrlShortnerServicesTest {

    @Mock
    private RedisTemplate<String, Object> redisTemplate;

    @Mock
    private ValueOperations<String, Object> valueOperations;

    private UrlShortnerServices service;

    @BeforeEach
    void setUp() {
        when(redisTemplate.opsForValue()).thenReturn(valueOperations);
        service = new UrlShortnerServices(redisTemplate);
        ReflectionTestUtils.setField(service, "baseUrl", "http://localhost:8082");
        ReflectionTestUtils.setField(service, "cacheTtlMinutes", 60);
    }

    @Test
    void shorteningReturnsTheCreationTime() {
        LocalDateTime beforeCreation = LocalDateTime.now();

        shortenUrlResponse response = service.shortUrl(request(), "127.0.0.1");

        LocalDateTime afterCreation = LocalDateTime.now();
        assertNotNull(response.getCreatedAt());
        assertFalse(response.getCreatedAt().isBefore(beforeCreation));
        assertFalse(response.getCreatedAt().isAfter(afterCreation));
    }

    @Test
    void statsAndAnalyticsPreserveTheCreationTimeAcrossLaterReads() {
        LocalDateTime createdAt = LocalDateTime.of(2026, 9, 7, 10, 0);
        LocalDateTime firstReadAt = createdAt.plusHours(1);
        LocalDateTime secondReadAt = createdAt.plusDays(1);

        try (MockedStatic<LocalDateTime> clock = mockStatic(LocalDateTime.class)) {
            clock.when(LocalDateTime::now).thenReturn(createdAt);
            shortenUrlResponse response = service.shortUrl(request(), "127.0.0.1");
            assertEquals(createdAt, response.getCreatedAt());

            for (LocalDateTime readAt : new LocalDateTime[]{firstReadAt, secondReadAt}) {
                clock.when(LocalDateTime::now).thenReturn(readAt);

                assertEquals(createdAt,
                        service.getUrlStats(response.getShortcode()).orElseThrow().getCreatedAt());
                assertEquals(createdAt,
                        service.getUrlAnalytics(response.getShortcode()).orElseThrow().getCreatedAt());
            }
        }
    }

    private ShortenUrlRequest request() {
        return ShortenUrlRequest.builder()
                .originalUrl("https://example.com/article")
                .customAlias("timestamp-test")
                .build();
    }
}
