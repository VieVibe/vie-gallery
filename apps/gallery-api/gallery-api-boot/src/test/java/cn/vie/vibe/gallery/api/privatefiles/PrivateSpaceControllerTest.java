package cn.vie.vibe.gallery.api.privatefiles;

import cn.vie.vibe.gallery.api.*;
import cn.vie.vibe.gallery.application.CurrentPrincipal;
import org.junit.jupiter.api.Test;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.*;

import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class PrivateSpaceControllerTest {
    @Test void everyDataEndpointRejectsOtherAuthenticatedUsersBeforeTouchingStorage() throws Exception {
        UUID owner = UUID.randomUUID();
        PrivateSpaceService service = mock(PrivateSpaceService.class);
        PrivateSpaceProperties properties = new PrivateSpaceProperties(true, owner, "", "", "", "", 32L << 30, 512L << 20);
        MockMvc mvc = mvc(properties, Optional.of(service));
        var stranger = new UsernamePasswordAuthenticationToken(new CurrentPrincipal(UUID.randomUUID()), null, List.of());
        mvc.perform(get("/api/private-space/access").principal(stranger)).andExpect(status().isOk()).andExpect(jsonPath("$.allowed").value(false));
        String file = UUID.randomUUID().toString();
        for (String path : List.of("/files", "/files/" + file + "/download", "/files/" + file + "/preview", "/exports/token"))
            mvc.perform(get("/api/private-space" + path).principal(stranger)).andExpect(status().isForbidden());
        for (String path : List.of("/uploads", "/uploads/" + file + "/complete", "/exports"))
            mvc.perform(post("/api/private-space" + path).contentType("application/json").content("{}").principal(stranger)).andExpect(status().isForbidden());
        verifyNoInteractions(service);
    }
    @Test void disabledFeatureDoesNotExposeOwnerOrReadDatabase() throws Exception {
        UUID owner = UUID.randomUUID();
        var principal = new UsernamePasswordAuthenticationToken(new CurrentPrincipal(owner), null, List.of());
        mvc(new PrivateSpaceProperties(false, owner, "", "", "", "", 0, 0), Optional.empty())
                .perform(get("/api/private-space/access").principal(principal)).andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "private, no-store"))
                .andExpect(jsonPath("$.allowed").value(false)).andExpect(jsonPath("$.quotaBytes").doesNotExist());
    }
    private MockMvc mvc(PrivateSpaceProperties properties, Optional<PrivateSpaceService> service) {
        return MockMvcBuilders.standaloneSetup(new PrivateSpaceController(properties, service))
                .setControllerAdvice(new GlobalExceptionHandler(new ApiErrorFactory())).build();
    }
}
