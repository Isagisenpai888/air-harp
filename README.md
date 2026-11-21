
## Camera & scrcpy Setup (Linux)

1. Load v4l2loopback:
   sudo modprobe v4l2loopback video_nr=10 card_label="PhoneCam" exclusive_caps=1

2. Stream phone camera to /dev/video10:
   scrcpy --video-source=camera --camera-id=0 --camera-size=1280x720 --camera-fps=30 --no-audio --v4l2-sink=/dev/video10

3. Open Air Harp (http://localhost:8080 or GitHub Pages) and select the virtual camera.
