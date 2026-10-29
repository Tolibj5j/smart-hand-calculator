"""Smart Hand Calculator - qo'l ishoralari bilan boshqariladigan kalkulyator."""

import threading

import customtkinter as ctk
import cv2
from PIL import Image

from ai_solver import solve_from_image
from calculator import safe_eval
from tracker import HandTracker

ctk.set_appearance_mode("dark")
ctk.set_default_color_theme("blue")

OPERATORS = "+-*/"
GESTURE_HOLD_FRAMES = 15   # ishorani necha kadr ushlab turish kerak
GESTURE_COOLDOWN = 10      # kiritilgandan keyin kutish (kadr)
FRAME_DELAY_MS = 30
VIDEO_SIZE = (640, 480)


class AICalculatorApp(ctk.CTk):
    def __init__(self):
        super().__init__()
        self.title("Smart Hand Calculator")
        self.geometry("1150x650")

        self.tracker = HandTracker()
        self.camera_index = 0
        self.cap = cv2.VideoCapture(self.camera_index)

        self.app_mode = "DRAW"
        self.is_mirrored = True
        self.current_symbol = None
        self.symbol_frames = 0
        self.ai_busy = False
        self.showing_message = False  # maydonda misol emas, xabar turibdimi
        self._camera_job = None

        self.grid_columnconfigure(0, weight=3)
        self.grid_columnconfigure(1, weight=1)
        self.grid_rowconfigure(0, weight=1)

        self._build_ui()
        self.protocol("WM_DELETE_WINDOW", self.on_closing)
        self.update_camera()

    # ---------- Interfeys ----------

    def _build_ui(self):
        video_frame = ctk.CTkFrame(self, corner_radius=15)
        video_frame.grid(row=0, column=0, padx=20, pady=20, sticky="nsew")
        video_frame.grid_rowconfigure(0, weight=1)
        video_frame.grid_columnconfigure(0, weight=1)

        self.video_label = ctk.CTkLabel(video_frame, text="Kamera yuklanmoqda...")
        self.video_label.grid(row=0, column=0, padx=10, pady=10, sticky="nsew")

        bar = ctk.CTkFrame(video_frame, fg_color="transparent")
        bar.grid(row=1, column=0, pady=10)

        self.camera_var = ctk.StringVar(value="Kamera 0")
        ctk.CTkOptionMenu(bar, values=[f"Kamera {i}" for i in range(4)], variable=self.camera_var,
                          command=self.change_camera, width=110).pack(side="left", padx=5)

        self.btn_mirror = ctk.CTkButton(bar, text="Oyna: YONIQ", command=self.toggle_mirror,
                                        fg_color="#2980B9", hover_color="#1F618D", width=110)
        self.btn_mirror.pack(side="left", padx=5)

        self.btn_mode = ctk.CTkButton(bar, text="Rejim: CHIZISH", command=self.toggle_mode,
                                      fg_color="#8E44AD", hover_color="#732D91", width=140)
        self.btn_mode.pack(side="left", padx=5)

        ctk.CTkButton(bar, text="Tozalash", command=self.clear_board, fg_color="#C0392B",
                      hover_color="#922B21", width=100).pack(side="left", padx=5)

        self.btn_solve = ctk.CTkButton(bar, text="Yechish (AI)", command=self.solve_ai,
                                       fg_color="#27AE60", hover_color="#1E8449", width=110)
        self.btn_solve.pack(side="left", padx=5)

        calc = ctk.CTkFrame(self, corner_radius=15)
        calc.grid(row=0, column=1, padx=(0, 20), pady=20, sticky="nsew")

        self.entry_var = ctk.StringVar()
        ctk.CTkEntry(calc, textvariable=self.entry_var, font=("Arial", 30), justify="right",
                     height=70).grid(row=0, column=0, columnspan=4, padx=15, pady=20, sticky="ew")

        buttons = ["7", "8", "9", "/",
                   "4", "5", "6", "*",
                   "1", "2", "3", "-",
                   "C", "0", "=", "+"]
        for i, char in enumerate(buttons):
            ctk.CTkButton(calc, text=char, width=65, height=65, font=("Arial", 26),
                          command=lambda c=char: self.on_calc_click(c)
                          ).grid(row=1 + i // 4, column=i % 4, padx=5, pady=5)

    def show_message(self, text):
        self.entry_var.set(text)
        self.showing_message = True

    # ---------- Boshqaruv ----------

    def change_camera(self, choice):
        new_index = int(choice.split()[1])
        if new_index == self.camera_index:
            return
        self.cap.release()
        cap = cv2.VideoCapture(new_index)
        if cap.isOpened():
            self.cap, self.camera_index = cap, new_index
        else:
            cap.release()
            self.show_message(f"Kamera {new_index} topilmadi")
            self.cap = cv2.VideoCapture(self.camera_index)
            self.camera_var.set(f"Kamera {self.camera_index}")

    def toggle_mirror(self):
        self.is_mirrored = not self.is_mirrored
        self.clear_board()  # eski chizmalar teskari bo'lib qolmasin
        if self.is_mirrored:
            self.btn_mirror.configure(text="Oyna: YONIQ", fg_color="#2980B9", hover_color="#1F618D")
        else:
            self.btn_mirror.configure(text="Oyna: O'CHIQ", fg_color="#7F8C8D", hover_color="#616A6B")

    def toggle_mode(self):
        self.current_symbol, self.symbol_frames = None, 0
        if self.app_mode == "DRAW":
            self.app_mode = "GESTURE"
            self.btn_mode.configure(text="Rejim: ISHORALAR", fg_color="#E67E22", hover_color="#D35400")
        else:
            self.app_mode = "DRAW"
            self.btn_mode.configure(text="Rejim: CHIZISH", fg_color="#8E44AD", hover_color="#732D91")
        self._update_solve_button()

    def _update_solve_button(self):
        enabled = self.app_mode == "DRAW" and not self.ai_busy
        self.btn_solve.configure(state="normal" if enabled else "disabled")

    def clear_board(self):
        self.tracker.clear_canvas()
        self.entry_var.set("")
        self.showing_message = False

    # ---------- Kalkulyator ----------

    def on_calc_click(self, char):
        current = self.entry_var.get().strip()
        if self.showing_message:
            current = ""
            self.showing_message = False

        if char == "C":
            self.entry_var.set("")
            return

        if char == "=":
            if not current or "=" in current:
                return
            try:
                self.entry_var.set(f"{current} = {safe_eval(current)}")
            except ZeroDivisionError:
                self.show_message("0 ga bo'lib bo'lmaydi")
            except Exception:
                self.show_message("Xato")
            return

        if "=" in current:
            # Natijadan keyin: amal - natija bilan davom etish, raqam - yangi misol
            result = current.split("=")[-1].strip()
            current = result if char in OPERATORS else ""
        self.entry_var.set(current + char)

    # ---------- Sun'iy intellekt ----------

    def solve_ai(self):
        if self.ai_busy or self.tracker.canvas is None:
            return
        canvas_copy = self.tracker.canvas.copy()  # asosiy oqimda nusxa olamiz
        self.ai_busy = True
        self._update_solve_button()
        self.show_message("Tanilmoqda...")
        threading.Thread(target=self._ai_worker, args=(canvas_copy,), daemon=True).start()

    def _ai_worker(self, canvas):
        result = solve_from_image(canvas)
        try:
            self.after(0, self._on_ai_result, result)
        except RuntimeError:
            pass  # oyna allaqachon yopilgan

    def _on_ai_result(self, result):
        self.ai_busy = False
        self._update_solve_button()
        if "=" in result:
            self.entry_var.set(result)
            self.showing_message = False
        else:
            self.show_message(result)

    # ---------- Kamera sikli ----------

    def _handle_gesture(self, frame, symbol):
        if symbol is None:
            self.current_symbol, self.symbol_frames = None, 0
            return

        if symbol == self.current_symbol:
            self.symbol_frames += 1
        else:
            self.current_symbol, self.symbol_frames = symbol, 1

        if self.symbol_frames > 0:
            progress = min(1.0, self.symbol_frames / GESTURE_HOLD_FRAMES)
            cv2.rectangle(frame, (20, 20), (220, 40), (80, 80, 80), 2)
            cv2.rectangle(frame, (20, 20), (20 + int(200 * progress), 40), (0, 255, 0), cv2.FILLED)
            # OpenCV shriftlari faqat lotin harflarini qo'llaydi
            cv2.putText(frame, f"Input: {symbol}", (20, 75), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (0, 255, 0), 3)

        if self.symbol_frames == GESTURE_HOLD_FRAMES:
            self.on_calc_click(symbol)
            self.symbol_frames = -GESTURE_COOLDOWN

    def update_camera(self):
        ok, frame = self.cap.read() if self.cap.isOpened() else (False, None)
        if ok:
            if self.is_mirrored:
                frame = cv2.flip(frame, 1)

            frame, _, symbol = self.tracker.process_frame(frame, mode=self.app_mode)
            if self.app_mode == "GESTURE":
                self._handle_gesture(frame, symbol)

            pil_image = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
            ctk_image = ctk.CTkImage(light_image=pil_image, dark_image=pil_image, size=VIDEO_SIZE)
            self.video_label.configure(image=ctk_image, text="")
            self.video_label.image = ctk_image

        self._camera_job = self.after(FRAME_DELAY_MS, self.update_camera)

    def on_closing(self):
        if self._camera_job:
            self.after_cancel(self._camera_job)
        self.cap.release()
        self.tracker.close()
        self.destroy()


if __name__ == "__main__":
    AICalculatorApp().mainloop()
