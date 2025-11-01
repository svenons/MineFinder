"""
Pygame UI widgets used by the sidebar.
"""
import pygame


class TextInput:
    def __init__(self, rect: pygame.Rect, text: str = "", numeric: bool = False, placeholder: str = ""):
        self.rect = rect
        self.text = text
        self.focused = False
        self.numeric = numeric
        self.cursor_visible = True
        self.cursor_timer = 0.0
        self.placeholder = placeholder

    def handle_event(self, e: pygame.event.Event):
        if e.type == pygame.MOUSEBUTTONDOWN and e.button == 1:
            self.focused = self.rect.collidepoint(e.pos)
        elif e.type == pygame.KEYDOWN and self.focused:
            if e.key == pygame.K_BACKSPACE:
                self.text = self.text[:-1]
            elif e.key == pygame.K_RETURN:
                self.focused = False
            else:
                ch = e.unicode
                if ch:
                    if not self.numeric or ch.replace('.', '', 1).isdigit():
                        self.text += ch

    def update(self, dt: float):
        self.cursor_timer += dt
        if self.cursor_timer >= 0.5:
            self.cursor_visible = not self.cursor_visible
            self.cursor_timer = 0.0

    def draw(self, surf: pygame.Surface, font: pygame.font.Font):
        pygame.draw.rect(surf, (240, 240, 240), self.rect, border_radius=4)
        pygame.draw.rect(surf, (120, 120, 120), self.rect, 1, border_radius=4)
        display_text = self.text if self.text else self.placeholder
        color = (20, 20, 20) if self.text else (140, 140, 140)
        txt = font.render(display_text, True, color)
        surf.blit(txt, (self.rect.x + 8, self.rect.y + 6))
        if self.focused and self.cursor_visible:
            cursor_x = self.rect.x + 8 + (font.size(self.text)[0] if self.text else 0) + 1
            cursor_y = self.rect.y + 6
            pygame.draw.line(surf, (20, 20, 20), (cursor_x, cursor_y), (cursor_x, cursor_y + txt.get_height()))

    def get_value(self, fallback: float) -> float:
        try:
            if self.numeric:
                return float(self.text)
            else:
                return float(self.text)
        except Exception:
            return fallback

    def get_text(self) -> str:
        return self.text


class Button:
    def __init__(self, rect: pygame.Rect, label: str, on_click):
        self.rect = rect
        self.label = label
        self.on_click = on_click
        self.pressed = False

    def handle_event(self, e: pygame.event.Event):
        if e.type == pygame.MOUSEBUTTONDOWN and e.button == 1 and self.rect.collidepoint(e.pos):
            self.pressed = True
        elif e.type == pygame.MOUSEBUTTONUP and e.button == 1:
            if self.pressed and self.rect.collidepoint(e.pos):
                self.on_click()
            self.pressed = False

    def draw(self, surf: pygame.Surface, font: pygame.font.Font):
        bg = (200, 220, 255) if self.pressed else (220, 235, 255)
        pygame.draw.rect(surf, bg, self.rect, border_radius=6)
        pygame.draw.rect(surf, (60, 100, 160), self.rect, 1, border_radius=6)
        txt = font.render(self.label, True, (20, 40, 80))
        surf.blit(txt, (self.rect.centerx - txt.get_width() // 2, self.rect.centery - txt.get_height() // 2))


class Dropdown:
    def __init__(self, rect: pygame.Rect, options: list, selected_id: str, on_change):
        """
        options: list of (id, label)
        selected_id: currently selected id
        on_change(id): callback when selection changes
        """
        self.rect = rect
        self.options = options
        self.open = False
        self.selected_id = selected_id
        self.on_change = on_change

    def set_options(self, options: list, selected_id: str):
        self.options = options
        self.selected_id = selected_id
        self.open = False

    def handle_event(self, e: pygame.event.Event):
        if e.type == pygame.MOUSEBUTTONDOWN and e.button == 1:
            if self.rect.collidepoint(e.pos):
                self.open = not self.open
            elif self.open:
                # Check clicks on options below
                opt_rects = self._option_rects()
                for (oid, _), r in zip(self.options, opt_rects):
                    if r.collidepoint(e.pos):
                        self.selected_id = oid
                        self.on_change(oid)
                        break
                self.open = False

    def _option_rects(self):
        rects = []
        x, y, w, h = self.rect
        for i in range(len(self.options)):
            rects.append(pygame.Rect(x, y + (i + 1) * h, w, h))
        return rects

    def draw(self, surf: pygame.Surface, font: pygame.font.Font):
        # Draw closed state
        pygame.draw.rect(surf, (240, 240, 240), self.rect, border_radius=4)
        pygame.draw.rect(surf, (120, 120, 120), self.rect, 1, border_radius=4)
        # Label of selected
        label = next((lbl for oid, lbl in self.options if oid == self.selected_id), "")
        txt = font.render(label, True, (20, 20, 20))
        surf.blit(txt, (self.rect.x + 8, self.rect.y + 6))
        # Draw arrow
        pygame.draw.polygon(surf, (80, 80, 80), [
            (self.rect.right - 18, self.rect.y + 10),
            (self.rect.right - 8, self.rect.y + 10),
            (self.rect.right - 13, self.rect.y + 18),
        ])
        # Draw options if open
        if self.open:
            opt_rects = self._option_rects()
            for (oid, lbl), r in zip(self.options, opt_rects):
                pygame.draw.rect(surf, (250, 250, 250), r)
                pygame.draw.rect(surf, (120, 120, 120), r, 1)
                t = font.render(lbl, True, (20, 20, 20))
                surf.blit(t, (r.x + 8, r.y + 6))
