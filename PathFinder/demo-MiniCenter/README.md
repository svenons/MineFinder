# Mine Detection Demo - MiniCenter

GUI application to showcase the machine learning mine detection model using the trained `fold_1_best.pt` checkpoint.

## Features

- 🖼️ **Image Selection**: Load any image (JPG, PNG, etc.)
- 🤖 **ML Detection**: Uses the trained PyTorch model to classify mine/no-mine
- 📊 **Confidence Display**: Shows prediction confidence percentage
- 🔄 **Clear Function**: Reset results while keeping the image displayed
- 🎨 **Clean Interface**: Simple Tkinter-based GUI

## Requirements

```bash
pip install torch torchvision pillow
```

## Usage

```bash
python mine_detector_gui.py
```

### Controls

1. **Select Image**: Opens file dialog to choose an image
2. **Detect Mine**: Runs the ML model on the selected image
3. **Clear**: Resets the prediction results (keeps image loaded)

### Results

- **✓ NO MINE** (Green): Model predicts no mine present
- **⚠️ MINE DETECTED** (Red): Model predicts mine is present
- Confidence percentage shows model certainty

## Model Information

- **Model File**: `fold_1_best.pt`
- **Device**: Automatically detects CUDA/CPU
- **Input Size**: 224x224 (resized automatically)
- **Classes**: Binary (Mine / No Mine)

## File Structure

```
demo-MiniCenter/
├── fold_1_best.pt          # Trained PyTorch model
├── mine_detector_gui.py    # Main GUI application
└── README.md              # This file
```

## Notes

- The model expects RGB images normalized with ImageNet statistics
- Images are automatically resized to 224x224 for prediction
- The GUI will display the full image (scaled to fit) regardless of input size
