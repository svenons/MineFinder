"""
Pygame UI widgets used by the sidebar.
"""
import pygame


class TextInput:
    def __init__(self, rect: pygame.Rect, text: str = "", numeric: bool = False):
        self.rect = rect
        self.text = text
        self.focused = False
        self.numeric = numeric
        self.cursor_visible = True
        self.cursor_timer = 0.0

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
                    if not self.numeric or ch.isdigit() or (ch == '.' and '.' not in self.text):
                        self.text += ch

    def update(self, dt: float):
        self.cursor_timer += dt
        if self.cursor_timer >= 0.5:
            self.cursor_visible = not self.cursor_visible
            self.cursor_timer = 0.0

    def draw(self, surf: pygame.Surface, font: pygame.font.Font):
        pygame.draw.rect(surf, (240, 240, 240), self.rect, border_radius=4)
        pygame.draw.rect(surf, (120, 120, 120), self.rect, 1, border_radius=4)
        txt = font.render(self.text, True, (20, 20, 20))
        surf.blit(txt, (self.rect.x + 8, self.rect.y + 6))
        if self.focused and self.cursor_visible:
            cursor_x = self.rect.x + 8 + txt.get_width() + 1
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
