package com.codebreaker.shortlink.services;

import com.codebreaker.shortlink.models.RateLimitData;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

@Service
@RequiredArgsConstructor
@Slf4j
public class RatelimitService {

    private final RedisTemplate<String, Object> redisTemplate;

    @Value("${shortlink.rate-limit.requests-per-minute}")
    private int requestPerMinute;

    @Value("${shortlink.rate-limit.request-per-hour}")
    private int requestPerHour;

    private final ConcurrentHashMap<String, RateLimitData> rateLimitData = new ConcurrentHashMap<>();

    private static final String REDIS_KEY_PREFIX = "ratelimit:";

    public boolean isAllowed(String clientIP) {

        String redisKey = REDIS_KEY_PREFIX + clientIP;

        LocalDateTime now = LocalDateTime.now();

        RateLimitData data = getRateLimitDataFromRedis(redisKey);

        if (data == null) {
            data = rateLimitData.computeIfAbsent(clientIP, k -> RateLimitData.builder()
                    .minuteCount(0)
                    .hourCount(0)
                    .minuteWindowStart(now)
                    .hourWindowStart(now)
                    .build());
        }

        if (isWithInMinuteWindow(data, now)) {

            if (data.getMinuteCount() >= requestPerMinute) {
                log.warn("Minute Limit Exceeded for Client IP {}", clientIP);
                return false;
            }

        } else {
            data.setMinuteCount(0);
            data.setMinuteWindowStart(now);
        }

        if (isWithInHourWindow(data, now)) {

            if (data.getHourCount() >= requestPerHour) {
                log.warn("Minute Limit Exceeded for Client IP {}", clientIP);
                return false;
            }

        } else {
            data.setHourCount(0);
            data.setHourWindowStart(now);
        }

        data.setMinuteCount(data.getMinuteCount() + 1);
        data.setHourCount(data.getHourCount() + 1);

        saveRateLimitDataToRedis(redisKey, data);

        return true;
    }

    private boolean isWithInHourWindow(RateLimitData data, LocalDateTime now) {

        return data.getHourWindowStart() != null && ChronoUnit.HOURS.between(
                data.getHourWindowStart(), now
        ) < 1;

    }

    private boolean isWithInMinuteWindow(RateLimitData data, LocalDateTime now) {

        return data.getMinuteWindowStart() != null && ChronoUnit.MINUTES.between(
                data.getMinuteWindowStart(), now
        ) < 1;

    }

    private void saveRateLimitDataToRedis(String redisKey, RateLimitData data) {

        try {

            redisTemplate.opsForValue().set(redisKey, data, 1, TimeUnit.HOURS);
        } catch (Exception e) {
            log.warn("Failed to save rate limit data to redis {}", e.getMessage());
        }
    }

    private RateLimitData getRateLimitDataFromRedis(String redisKey) {

        try {

            return (RateLimitData) redisTemplate.opsForValue().get(redisKey);
        } catch (Exception e) {

            log.warn("failed to get rate limit data from redis", e.getMessage());

            return null;
        }

    }

    public int getRemainingRequests(String clientIP) {
        String redisKey = REDIS_KEY_PREFIX + clientIP;
        RateLimitData data = getRateLimitDataFromRedis(redisKey);

        if (data == null) {
            return requestPerMinute;
        }

        LocalDateTime now = LocalDateTime.now();

        if (!isWithInMinuteWindow(data, now)) {
            return requestPerMinute;
        }

        return Math.max(0, requestPerMinute - data.getMinuteCount());

    }

    public long getTimeUntilReset(String clientIP) {
        String redisKey = REDIS_KEY_PREFIX + clientIP;
        RateLimitData data = getRateLimitDataFromRedis(redisKey);

        if (data == null) {
            return 0;
        }

        LocalDateTime now = LocalDateTime.now();

        if (data.getMinuteCount() >= requestPerMinute) {
            LocalDateTime nextMinute = data.getMinuteWindowStart()
                    .plusMinutes(1);

            return ChronoUnit.SECONDS.between(now, nextMinute);
        }

        if (data.getHourCount() >= requestPerHour) {
            LocalDateTime nextHour = data.getHourWindowStart()
                    .plusHours(1);

            return ChronoUnit.SECONDS.between(now, nextHour);
        }

        return 0;

    }


}
