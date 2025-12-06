"""
Simple Mine Detection Demo - Just load model and predict
"""
import tkinter as tk
from tkinter import ttk, filedialog
from PIL import Image, ImageTk
import torch
from pathlib import Path
import sys

# Add the EXP_T-ML-LWIR to path
sys.path.insert(0, str(Path(__file__).parent.parent / "EXP_T-ML-LWIR"))
from main import LandmineDetector


class SimpleMineDemo:
    def __init__(self, root):
        self.root = root
        self.root.title("Mine Detection Demo")
        self.root.geometry("1000x800")
        
        # Load the ACTUAL trained model using the real LandmineDetector
        checkpoint_path = Path(__file__).parent / "fold_1_best.pt"
        self.detector = LandmineDetector(str(checkpoint_path), device='cpu')
        
        self.current_image = None
        self.photo = None
        
        self.setup_ui()

    
    def setup_ui(self):
        # Title
        title = ttk.Label(self.root, text="Mine Detection Demo", font=("Arial", 20, "bold"))
        title.pack(pady=10)
        
        # Buttons
        btn_frame = ttk.Frame(self.root)
        btn_frame.pack(pady=10)
        
        self.select_btn = ttk.Button(btn_frame, text="Select Image", command=self.select_image, width=20)
        self.select_btn.pack(side=tk.LEFT, padx=5)
        
        self.predict_btn = ttk.Button(btn_frame, text="Detect Mine", command=self.predict, width=20, state=tk.DISABLED)
        self.predict_btn.pack(side=tk.LEFT, padx=5)
        
        self.clear_btn = ttk.Button(btn_frame, text="Clear", command=self.clear, width=20)
        self.clear_btn.pack(side=tk.LEFT, padx=5)
        
        # Image display - fixed height to prevent pushing result off screen
        img_frame = ttk.LabelFrame(self.root, text="Image", padding=10)
        img_frame.pack(fill=tk.BOTH, padx=10, pady=10)
        img_frame.pack_propagate(False)  # Don't let content resize the frame
        img_frame.configure(height=550)  # Fixed height
        
        self.img_label = ttk.Label(img_frame, text="No image loaded", anchor=tk.CENTER, background="#f0f0f0")
        self.img_label.pack(fill=tk.BOTH, expand=True)
        
        # Result
        result_frame = ttk.LabelFrame(self.root, text="Result", padding=10)
        result_frame.pack(fill=tk.X, padx=10, pady=10)
        
        self.result_label = ttk.Label(result_frame, text="", font=("Arial", 18, "bold"), anchor=tk.CENTER)
        self.result_label.pack(pady=5)
        
        self.conf_label = ttk.Label(result_frame, text="", font=("Arial", 12), anchor=tk.CENTER)
        self.conf_label.pack()
        
        # Status
        self.status = ttk.Label(self.root, text="Ready", relief=tk.SUNKEN, anchor=tk.W)
        self.status.pack(fill=tk.X, side=tk.BOTTOM)
    
    def select_image(self):
        path = filedialog.askopenfilename(
            title="Select Image",
            filetypes=[("Images", "*.jpg *.jpeg *.png"), ("All", "*.*")]
        )
        if path:
            # Clear old results first
            self.result_label.config(text="", foreground="black")
            self.conf_label.config(text="")
            
            self.current_image = path
            self.display_image(path)
            self.predict_btn.config(state=tk.NORMAL)
            self.status.config(text=f"Loaded: {Path(path).name} - Press 'Detect Mine' to analyze")
    
    def display_image(self, path):
        # Load image and scale to fit in frame while maintaining aspect ratio
        img = Image.open(path)
        
        # Target size for the display area
        max_width = 940
        max_height = 510
        
        # Calculate scaling to fit within bounds
        img.thumbnail((max_width, max_height), Image.Resampling.LANCZOS)
        
        self.photo = ImageTk.PhotoImage(img)
        self.img_label.config(image=self.photo, text="")
    
    def clear(self):
        self.result_label.config(text="", foreground="black")
        self.conf_label.config(text="")
        if self.current_image:
            self.status.config(text=f"Cleared. Image: {Path(self.current_image).name}")
    
    def predict(self):
        if not self.current_image:
            return
        
        self.status.config(text="Processing...")
        self.root.update()
        
        # Use the actual trained model
        result = self.detector.predict_image(self.current_image)
        
        # Display result
        class_name = result['class_name']
        confidence = result['confidence']
        
        if result['predicted_class'] == 1:
            text = "⚠️ MINE DETECTED"
            color = "red"
        else:
            text = "✓ NO MINE"
            color = "green"
        
        self.result_label.config(text=text, foreground=color)
        self.conf_label.config(text=f"Confidence: {confidence*100:.1f}%")
        self.status.config(text=f"Done: {class_name}")


if __name__ == "__main__":
    root = tk.Tk()
    app = SimpleMineDemo(root)
    root.mainloop()
