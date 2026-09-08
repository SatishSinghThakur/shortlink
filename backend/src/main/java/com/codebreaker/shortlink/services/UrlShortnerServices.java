package com.codebreaker.shortlink.services;


import com.codebreaker.shortlink.controllers.UrlStatsResponse;
import com.codebreaker.shortlink.dto.ShortenUrlRequest;
import com.codebreaker.shortlink.dto.UrlAnalyticsResponse;
import com.codebreaker.shortlink.dto.shortenUrlResponse;
import com.codebreaker.shortlink.models.ClickEvent;
import com.codebreaker.shortlink.models.UrlData;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
@Slf4j

public class UrlShortnerServices {

    private final RedisTemplate<String, Object> redisTemplate;

    private final Map<String, UrlData> urlMapping = new ConcurrentHashMap<>();

    private final Map<String, List<ClickEvent>> clickAnalytics = new ConcurrentHashMap<>();

    @Value("${shortlink.base-url}")
    private String baseUrl;

    @Value("${shortlink.short-code.length}")
    private int shortCodeLength;

    @Value("${shortlink.short-code.max-attempts}")
    private int maxGenerationAttempts;

    @Value("${shortlink.cache.ttl-minutes}")
    private int cacheTtlMinutes;

    private static final String BASE_62_CHARS =
            "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

    public shortenUrlResponse shortUrl(ShortenUrlRequest request, String clientIP) {

        String shortCode = request.getCustomAlias();

        if (shortCode == null || shortCode.trim().isEmpty()) {
            shortCode = generateUniqueShortCode();
        } else {
            shortCode = shortCode.trim();
            if (shortCodeExists(shortCode)) {
                throw new IllegalArgumentException("Custom Alias already exists: " + shortCode);
            }

        }

        UrlData urlData = UrlData.builder()
                .originalUrl(request.getOriginalUrl())
                .shortcode(shortCode)
                .createdAt(LocalDateTime.now())
                .expiresAt(request.getExpiresAt())
                .createdBy(clientIP)
                .clickCount(0)
                .isActive(true)
                .clickEvents(new ArrayList<>())
                .build();

        urlMapping.put(shortCode, urlData);
        clickAnalytics.put(shortCode, new ArrayList<>());

        cacheUrl(shortCode, request.getOriginalUrl());

        log.info("Created short URL: {} -> {}", shortCode, request.getOriginalUrl());

        return shortenUrlResponse.builder()
                .shortUrl(buildShortUrl(shortCode))
                .shortcode(shortCode)
                .originalUrl(request.getOriginalUrl())
                .createdAt(urlData.getCreatedAt())
                .expiresAt(urlData.getExpiresAt())
                .build();
    }

    private String buildShortUrl(String shortCode) {

        String normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;

        return normalizedBaseUrl + "/api/" + shortCode;
    }

    private void cacheUrl(String shortCode, String originalUrl) {

        try {

            redisTemplate.opsForValue().set("url:" + shortCode, originalUrl, cacheTtlMinutes, TimeUnit.MINUTES);
        } catch (Exception e) {
            log.warn("failed to cache URL for {}: {}", shortCode, e.getMessage());
        }


    }

    private boolean shortCodeExists(String shortCode) {
        return urlMapping.containsKey(shortCode);
    }

    private String generateUniqueShortCode() {
        for (int attempt = 0; attempt < maxGenerationAttempts; attempt++) {
            String code = generateRandomBase62();

            if (!shortCodeExist(code)) {
                return code;
            }

        }

        throw new RuntimeException("Failed to generate Unique short code after " + maxGenerationAttempts + " attempts");

    }

    private boolean shortCodeExist(String code) {
        return urlMapping.containsKey(code);
    }

    private String generateRandomBase62() {

        StringBuilder sb = new StringBuilder(shortCodeLength);
        for (int i = 0; i < shortCodeLength; i++) {
            int index = ThreadLocalRandom.current().nextInt(BASE_62_CHARS.length());
            sb.append(BASE_62_CHARS.charAt(index));
        }

        return sb.toString();
    }


    public Optional<String> getOriginalUrl(String shortCode) {
        String cachedUrl = getCachedUrl(shortCode);
        if (cachedUrl != null) {
            return Optional.of(cachedUrl);
        }

        UrlData urlData = urlMapping.get(shortCode);

        if (urlData != null && urlData.isActive()) {

            if (isExperied(urlData)) {
                urlData.setActive(false);
                return Optional.empty();
            }

            cacheUrl(shortCode, urlData.getOriginalUrl());
            return Optional.of(urlData.getOriginalUrl());

        }

        return Optional.empty();

    }

    private boolean isExperied(UrlData urlData) {
        return urlData.getExpiresAt() != null && urlData.getExpiresAt().isBefore(LocalDateTime.now());
    }

    private String getCachedUrl(String shortCode) {

        try {

            return (String) redisTemplate.opsForValue().get("url: " + shortCode);

        } catch (Exception e) {

            log.warn("failed to get cached URL for {}: {}", shortCode, e.getMessage());
            return null;
        }

    }

    public void recordClick(String shortCode, String clientIP, String useragent, String referrer) {

        UrlData urlData = urlMapping.get(shortCode);
        if (urlData != null && urlData.isActive()) {
            urlData.setClickCount(urlData.getClickCount() + 1);

            ClickEvent clickEvent = ClickEvent.builder()
                    .timestamp(LocalDateTime.now())
                    .ipAddress(clientIP)
                    .userAgent(useragent)
                    .referrer(referrer)
                    .build();

            clickAnalytics.get(shortCode).add(clickEvent);
            log.debug("Recorder click for short code: {}", shortCode);
        }
    }

    public Optional<UrlStatsResponse> getUrlStats(String shortCode) {

        UrlData urlData = urlMapping.get(shortCode);

        if (urlData == null) {
            return Optional.empty();
        }
        return Optional.of(UrlStatsResponse.builder()
                .shortCode(shortCode)
                .originalUrl(urlData.getOriginalUrl())
                .clickCount(urlData.getClickCount())
                .createdAt(urlData.getCreatedAt())
                .expiresAt(urlData.getExpiresAt())
                .isActive(urlData.isActive()).createdBy(urlData.getCreatedBy())
                .build());
    }

    public Optional<UrlAnalyticsResponse> getUrlAnalytics(String shortCode) {

        UrlData urlData = urlMapping.get(shortCode);
        if (urlData == null) {
            return Optional.empty();
        }

        List<ClickEvent> clicks = clickAnalytics.getOrDefault(shortCode, new ArrayList<>());

        Map<String, Integer> clicksByReferrer = clicks.stream()
                .filter(c -> c.getReferrer() != null)
                .collect(Collectors.groupingBy(
                        ClickEvent::getReferrer, Collectors.summingInt(e -> 1)

                ));

        Map<String, Integer> clicksByHour = clicks.stream()
                .collect(Collectors.groupingBy(
                        c -> c.getTimestamp().getHour() + ":00",
                        Collectors.summingInt(e -> 1)
                ));

        Map<String, Integer> clicksByDay = clicks.stream()
                .collect(Collectors.groupingBy(
                        c -> c.getTimestamp().toLocalDate().toString(),
                        Collectors.summingInt(e -> 1)
                ));

        List<ClickEvent> recentClicks = clicks.stream()
                .sorted((a, b) -> b.getTimestamp().compareTo(a.getTimestamp()))
                .limit(10)
                .toList();

        return Optional.of(UrlAnalyticsResponse.builder()
                .shortCode(shortCode)
                .originalUrl(urlData.getOriginalUrl())
                .totalClicks(urlData.getClickCount())
                .createdAt(urlData.getCreatedAt())
                .expiredAt(urlData.getExpiresAt())
                .recentClicks(recentClicks)
                .clicksByReferrer(clicksByReferrer)
                .clicksByHour(clicksByHour)
                .clicksByDay(clicksByDay)
                .build()


        );

    }

    public boolean deleteUrl(String shortCode) {
        UrlData urlData = urlMapping.get(shortCode);
        if (urlData != null) {

            urlData.setActive(false);
            deltCacheUrl(shortCode);
            log.info("Deleted URL: {}", shortCode);
            return true;
        }
        return false;
    }

    private void deltCacheUrl(String shortCode) {

        try {
            redisTemplate.delete("url: " + shortCode);

        } catch (Exception e) {
            log.warn("failed to delete cache URL {}: {}", shortCode, e.getMessage());
        }

    }

    public void cleanUpExpeiredUrl() {

        int cleanCount = 0;
        LocalDateTime now = LocalDateTime.now();

        for (Map.Entry<String, UrlData> entry : urlMapping.entrySet()) {

            UrlData urlData = entry.getValue();

            if (urlData.getExpiresAt() != null && urlData.getExpiresAt().isBefore(now) && urlData.isActive()) {
                urlData.setActive(false);
                deltCacheUrl(entry.getKey());
                cleanCount++;
            }
        }

        if (cleanCount > 0) {
            log.info("Cleaned up expeired URLs: {}", cleanCount);
        }

    }
}
