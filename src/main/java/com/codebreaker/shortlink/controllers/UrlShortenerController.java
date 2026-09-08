package com.codebreaker.shortlink.controllers;

import com.codebreaker.shortlink.dto.ShortenUrlRequest;
import com.codebreaker.shortlink.dto.UrlAnalyticsResponse;
import com.codebreaker.shortlink.dto.shortenUrlResponse;
import com.codebreaker.shortlink.services.RatelimitService;
import com.codebreaker.shortlink.services.UrlShortnerServices;
import jakarta.servlet.http.HttpServlet;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;
import java.util.Optional;

import static org.springframework.http.HttpStatus.TOO_MANY_REQUESTS;

@RestController
@RequestMapping("/api")
@Slf4j
@RequiredArgsConstructor
public class UrlShortenerController {

    private final UrlShortnerServices urlShortnerServices;
    private final RatelimitService ratelimitService;

    @PostMapping("/shorten")
    public ResponseEntity<?> shortenUrl(

            @Valid @RequestBody ShortenUrlRequest request,
            HttpServletRequest httpRequest

    ) {
        String clientIP = getClientIP(httpRequest);
        if (!ratelimitService.isAllowed(clientIP)) {
            return ResponseEntity.status(TOO_MANY_REQUESTS)
                    .body(Map.of(
                            "error", "Rate limit exceeded",
                            "remainingRequest", ratelimitService.getRemainingRequests(clientIP),
                            "timeUntilReset", ratelimitService.getTimeUntilReset(clientIP)
                    ));
        }

        try {
            shortenUrlResponse response = urlShortnerServices.shortUrl(request, clientIP);

            return ResponseEntity.ok(response);

        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("error", "Internal server error"));
        }

    }


    @GetMapping("/{shortCode}")
    public ResponseEntity<Void> redirectUrl(
            @PathVariable String shortCode,
            HttpServletRequest request,
            HttpServletResponse response) {
        String clientIP = getClientIP(request);
        String useragent = request.getHeader("User-Agent");
        String referrer = request.getHeader("Referer");

        Optional<String> originalUrl = urlShortnerServices.getOriginalUrl(shortCode);
        if (originalUrl.isPresent()) {

            urlShortnerServices.recordClick(shortCode, clientIP, useragent, referrer);
            response.setHeader("Location", originalUrl.get());

            return ResponseEntity.status(HttpStatus.FOUND).build();

        } else {
            return ResponseEntity.notFound().build();
        }
    }


    @GetMapping("/stats/{shortCode}")
    public ResponseEntity<?> getUrlStats(
            @PathVariable String shortCode
    ) {
        Optional<UrlStatsResponse> stats = urlShortnerServices.getUrlStats(shortCode);

        if (stats.isPresent()) {
            return ResponseEntity.ok(stats.get());
        } else {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(Map.of("error", "Short Code Url Not Found"));

        }

    }

    @GetMapping("/analytics/{shortCode}")
    public ResponseEntity<?> getUrlAnalytics(
            @PathVariable String shortCode
    ) {
        Optional<UrlAnalyticsResponse> analytics = urlShortnerServices.getUrlAnalytics(shortCode);

        if (analytics.isPresent()) {
            return ResponseEntity.ok(analytics.get());

        } else {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(Map.of("error", "Short Code Url Not Found"));
        }
    }

    @DeleteMapping("/{shortCode}")
    public ResponseEntity<?> deleteUrl(@PathVariable String shortCode) {
        boolean deleted = urlShortnerServices.deleteUrl(shortCode);

        if (deleted) {
            return ResponseEntity.ok(Map.of("message", "URL Deleted Successfully"));
        } else {

            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(Map.of("error", "Short Code Url Not Found"));

        }

    }

    private String getClientIP(HttpServletRequest httpRequest) {
        String xForwardedFor = httpRequest.getHeader("X-Forwarded-For");
        if (xForwardedFor != null && !xForwardedFor.isEmpty()) {
            return xForwardedFor.split(",")[0].trim();
        }

        String xReadIp = httpRequest.getHeader("X-Real-IP");
        if (xReadIp != null && !xReadIp.isEmpty()) {
            return xReadIp;
        }

        return httpRequest.getRemoteAddr();

    }


}


