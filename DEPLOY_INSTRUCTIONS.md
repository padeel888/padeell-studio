# Padeel Studio v2

This repo is intended to host Padeel Studio v2 on Render as a Docker web service.

Upload the extracted contents of `Padeel-Studio-v2-Render-Ready.zip` to the root of this repo (not the ZIP alone). The root should contain `app.py`, `Dockerfile`, `render.yaml`, `requirements.txt` and the `static` folder.

On Render, choose **New > Blueprint** and select this repo. Configure `PADEEL_SITE_PASSWORD` as a secret at least 12 characters long. Never commit Roblox API keys or passwords.
