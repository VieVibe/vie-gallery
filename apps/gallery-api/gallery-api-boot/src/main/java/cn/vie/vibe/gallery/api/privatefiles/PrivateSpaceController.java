package cn.vie.vibe.gallery.api.privatefiles;

import cn.vie.vibe.gallery.application.CurrentPrincipal;
import cn.vie.vibe.gallery.domain.DomainException;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import org.springframework.http.*;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.io.IOException;
import java.io.Serializable;
import java.time.Instant;
import java.util.*;

@RestController
@RequestMapping("/api/private-space")
public class PrivateSpaceController {
    private final PrivateSpaceProperties properties;
    private final Optional<PrivateSpaceService> service;
    public PrivateSpaceController(PrivateSpaceProperties properties, Optional<PrivateSpaceService> service) {
        this.properties = properties; this.service = service;
    }
    private UUID owner(Authentication auth) { return ((CurrentPrincipal) auth.getPrincipal()).userId(); }
    private PrivateSpaceService require(Authentication auth) {
        if (!properties.allows(owner(auth)) || service.isEmpty()) throw new DomainException("MEMBER_FORBIDDEN", "无权访问私人空间");
        return service.get();
    }
    @ModelAttribute
    void noCache(HttpServletResponse response) { response.setHeader("Cache-Control", "private, no-store"); }

    @GetMapping("/access")
    public Map<String, Object> access(Authentication auth) {
        boolean allowed = properties.allows(owner(auth)) && service.isPresent();
        return allowed ? Map.of("allowed", true, "quotaBytes", properties.quotaBytes(), "maxFileBytes", properties.maxFileBytes())
                : Map.of("allowed", false);
    }
    @GetMapping("/files")
    public List<PrivateSpaceService.FileView> list(Authentication auth) { return require(auth).list(owner(auth)); }
    @PostMapping("/uploads")
    public PrivateSpaceService.UploadResult start(Authentication auth, @RequestBody PrivateSpaceService.Start request) {
        return require(auth).start(owner(auth), request);
    }
    @PostMapping("/uploads/{id}/complete")
    public PrivateSpaceService.FileView complete(Authentication auth, @PathVariable UUID id) {
        return require(auth).complete(owner(auth), id);
    }
    @GetMapping("/files/{id}/download")
    public Map<String, String> download(Authentication auth, @PathVariable UUID id) {
        return Map.of("url", require(auth).download(owner(auth), id));
    }
    @GetMapping("/files/{id}/preview")
    public ResponseEntity<byte[]> preview(Authentication auth, @PathVariable UUID id) throws IOException {
        return ResponseEntity.ok().contentType(MediaType.IMAGE_JPEG).body(require(auth).preview(owner(auth), id));
    }
    public record ExportRequest(List<UUID> ids) {}
    private record ExportTicket(UUID owner, List<UUID> ids, Instant expires) implements Serializable {}
    private static final String TICKET_KEY = "private-space-export";
    @PostMapping("/exports")
    public Map<String, String> prepareExport(Authentication auth, @RequestBody ExportRequest request, HttpSession session) {
        PrivateSpaceService space = require(auth);
        List<UUID> ids = space.exportFiles(owner(auth), request.ids()).stream().map(PrivateSpaceRepository.FileRecord::id).toList();
        String token = UUID.randomUUID().toString();
        // One current ticket per session bounds memory and avoids giant download URLs.
        session.setAttribute(TICKET_KEY, new TicketWithToken(token, new ExportTicket(owner(auth), ids, Instant.now().plusSeconds(900))));
        return Map.of("url", "/api/private-space/exports/" + token);
    }
    private record TicketWithToken(String token, ExportTicket ticket) implements Serializable {}
    @GetMapping("/exports/{token}")
    public void export(Authentication auth, @PathVariable String token, HttpSession session, HttpServletResponse response) throws IOException {
        PrivateSpaceService space = require(auth);
        Object raw = session.getAttribute(TICKET_KEY);
        if (!(raw instanceof TicketWithToken saved) || !saved.token().equals(token)
                || !saved.ticket().owner().equals(owner(auth)) || saved.ticket().expires().isBefore(Instant.now()))
            throw new DomainException("RESOURCE_NOT_FOUND", "下载链接已失效，请重新选择文件下载");
        space.exportFiles(owner(auth), saved.ticket().ids());
        response.setContentType("application/zip");
        response.setHeader("Content-Disposition", "attachment; filename=private-space-originals.zip");
        response.setHeader("X-Content-Type-Options", "nosniff");
        response.setHeader("X-Accel-Buffering", "no");
        space.export(owner(auth), saved.ticket().ids(), response.getOutputStream());
    }
}
