package cn.vie.vibe.gallery.api;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.*;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

public class GalleryLifecycleIntegrationTest extends AbstractIntegrationTest {

    @Autowired
    private TestRestTemplate restTemplate;

    private HttpHeaders register(String email, String displayName) {
        var csrf = restTemplate.getForEntity("/api/auth/csrf", Map.class);
        assertEquals(HttpStatus.OK, csrf.getStatusCode());
        assertNotNull(csrf.getBody());
        String csrfCookie = cookie(csrf.getHeaders(), "XSRF-TOKEN=");
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.set(HttpHeaders.COOKIE, csrfCookie);
        headers.set("X-XSRF-TOKEN", (String) csrf.getBody().get("token"));
        HttpEntity<Map<String, String>> registerEntity = new HttpEntity<>(Map.of(
                "email", email,
                "displayName", displayName,
                "password", "Password123456"
        ), headers);

        ResponseEntity<Map> registerResp = restTemplate.postForEntity("/api/auth/register", registerEntity, Map.class);
        assertEquals(HttpStatus.CREATED, registerResp.getStatusCode());
        String sessionCookie = cookie(registerResp.getHeaders(), "VIE_SESSION=", "SESSION=", "JSESSIONID=");
        headers.set(HttpHeaders.COOKIE, csrfCookie + "; " + sessionCookie);
        return headers;
    }

    private static String cookie(HttpHeaders headers, String... prefixes) {
        return headers.getOrEmpty(HttpHeaders.SET_COOKIE).stream()
                .filter(entry -> java.util.Arrays.stream(prefixes).anyMatch(entry::startsWith))
                .map(entry -> entry.split(";", 2)[0])
                .findFirst().orElseThrow();
    }

    @Test
    void testCompleteGalleryLifecycle() {
        String email = "creator-" + System.currentTimeMillis() + "@example.com";
        HttpHeaders authHeaders = register(email, "Creator Test");

        // 2. Create Gallery
        String slug = "travel-" + System.currentTimeMillis();
        HttpEntity<Map<String, String>> createEntity = new HttpEntity<>(Map.of(
                "name", "My Travel Gallery",
                "slug", slug,
                "visibility", "PUBLIC"
        ), authHeaders);

        ResponseEntity<GalleryController.GalleryResponse> createResp = restTemplate.exchange(
                "/api/galleries", HttpMethod.POST, createEntity, GalleryController.GalleryResponse.class);
        assertEquals(HttpStatus.CREATED, createResp.getStatusCode());
        assertNotNull(createResp.getBody());
        String galleryId = createResp.getBody().id();
        assertEquals(slug, createResp.getBody().slug());

        // 3. Check Publish Readiness (Should block because 0 ready photos)
        ResponseEntity<GalleryController.PublishReadinessResponse> readinessResp = restTemplate.exchange(
                "/api/galleries/" + galleryId + "/publish-readiness",
                HttpMethod.GET,
                new HttpEntity<>(authHeaders),
                GalleryController.PublishReadinessResponse.class
        );
        assertEquals(HttpStatus.OK, readinessResp.getStatusCode());
        assertNotNull(readinessResp.getBody());
        assertFalse(readinessResp.getBody().galleryPublishable());
        assertTrue(readinessResp.getBody().blockers().stream().anyMatch(b -> "NO_READY_PHOTOS".equals(b.code())));

        // 4. Issue Creator Preview Token
        ResponseEntity<GalleryController.PreviewTokenResponse> tokenResp = restTemplate.exchange(
                "/api/galleries/" + galleryId + "/preview-token",
                HttpMethod.POST,
                new HttpEntity<>(authHeaders),
                GalleryController.PreviewTokenResponse.class
        );
        assertEquals(HttpStatus.OK, tokenResp.getStatusCode());
        assertNotNull(tokenResp.getBody());
        String previewToken = tokenResp.getBody().token();
        assertNotNull(previewToken);

        // 5. Public access without token on DRAFT gallery -> 404
        ResponseEntity<String> publicWithoutToken = restTemplate.getForEntity("/api/public/g/" + slug, String.class);
        assertEquals(HttpStatus.NOT_FOUND, publicWithoutToken.getStatusCode());

        // 6. Public access with preview token on DRAFT gallery -> 200
        ResponseEntity<String> publicWithToken = restTemplate.getForEntity("/api/public/g/" + slug + "?preview=" + previewToken, String.class);
        assertEquals(HttpStatus.OK, publicWithToken.getStatusCode());
    }

    @Test
    void publishReadinessBlocksWithoutReadyPhotos() {
        String email = "blocked-" + System.currentTimeMillis() + "@example.com";
        HttpHeaders authHeaders = register(email, "Blocked Test");

        String slug = "blocked-" + System.currentTimeMillis();
        ResponseEntity<GalleryController.GalleryResponse> createResp = restTemplate.exchange(
                "/api/galleries",
                HttpMethod.POST,
                new HttpEntity<>(Map.of("name", "Blocked Gallery", "slug", slug, "visibility", "PUBLIC"), authHeaders),
                GalleryController.GalleryResponse.class);
        assertEquals(HttpStatus.CREATED, createResp.getStatusCode());
        String galleryId = createResp.getBody().id();

        ResponseEntity<GalleryController.PublishReadinessResponse> readinessResp = restTemplate.exchange(
                "/api/galleries/" + galleryId + "/publish-readiness",
                HttpMethod.GET,
                new HttpEntity<>(authHeaders),
                GalleryController.PublishReadinessResponse.class);
        assertEquals(HttpStatus.OK, readinessResp.getStatusCode());
        assertNotNull(readinessResp.getBody());
        assertFalse(readinessResp.getBody().galleryPublishable());
        assertNull(readinessResp.getBody().draftConfigVersionId());
    }
}
