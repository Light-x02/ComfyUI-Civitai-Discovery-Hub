⭐ **Give a star, it shines and keeps us motivated! ✨**

## Changelog (Improvements + Bug Fixes)

### 2025-12-16 — Major Update (V3 + UI + Stability)

#### ✅ V3 Migration (code fully rewritten)
- Migrated the **🖼️ Civitai Discovery Hub** node to **V3**.
- For this migration, **all code was rewritten** (Python + JavaScript) to be cleaner, V3-compatible, and more robust.

#### 🔧 Universal Loader (V3)
- The `__init__.py` was designed as a **universal V3 loader**: it automatically detects **all Python files** in the folder and loads them, without needing manual imports.

#### 🚀 Stability & Performance
- Fixed a bug where the gallery could shift / “move by itself”: if you scrolled down, then panned the workflow view and came back to the node, the list would unexpectedly re-align.
- Fixed a related issue: when returning to the node after moving around the workflow, it could **append already-loaded images again**, which could eventually slow down ComfyUI.

✅ The gallery now stays **exactly** at the same position as long as you don’t scroll, and it no longer duplicates content when you move around the workflow.


# 📜 ComfyUI-Civitai-Discovery-Hub

![ComfyUI](https://img.shields.io/badge/ComfyUI-custom%20nodes-5a67d8)
![License: MIT](https://img.shields.io/badge/License-MIT-green)
![Status](https://img.shields.io/badge/status-active-brightgreen)

[☕ Support on Ko-fi](https://ko-fi.com/light_x02)

> Browse the **Civitai** gallery directly inside **ComfyUI**: enjoy infinite scrolling, advanced filters (including **NSFW**), favorites management, **videos only** mode, and direct integration of prompts, metadata, and images/videos into your workflows.

- **GitHub**: [https://github.com/Light-x02/ComfyUI-Civitai-Discovery-Hub](https://github.com/Light-x02/ComfyUI-Civitai-Discovery-Hub)
- **Node name in ComfyUI**: **Civitai Discovery Hub**

![comfyui_civitai_gallery_001](assets/062107.png)

---

## ✨ Main Features

- **Infinite scrolling**: automatically loads more items when reaching the bottom, with no limit.
- **Advanced filters**: NSFW, sort (Newest / Most Reactions / Most Comments), period (Day / Week / Month / Year / AllTime), tags, user.
- **“Videos only” mode**: display only videos.
- **"Hide no-prompt"**: exclude content without positive prompts.
- **Favorites**: add/remove favorites (★) and switch to **Favorites only** view.
- **Workflow outputs**: positive/negative prompts, JSON metadata, selected image/video.
- **Modern UI**: adaptive masonry grid, polished design, real-time loading status.

---

## 🧩 Installation

### Method 1: Install via ComfyUI Manager

2. Go to the **Custom Nodes** section in the interface.
3. Search for **"ComfyUI-Civitai-Discovery-Hub"** and install it directly from the ComfyUI Manager.
4. **Restart ComfyUI**  
   Restart ComfyUI to load the node.

### Method 2: Clone the Repository
1. Open a terminal or command prompt.
2. Run the following command to clone the repository:
   ```bash
   git clone https://github.com/Light-x02/ComfyUI-Civitai-Discovery-Hub.git
   ```
3. **Restart ComfyUI**  
   Once the files are in place, restart ComfyUI to load the node.

---

## 🚀 Usage in a workflow

Node outputs:

- **Positive Prompt** *(STRING)*
- **Negative Prompt** *(STRING)*
- **Image** *(IMAGE tensor, downloaded if a connection is active)*
- **Info** *(STRING, formatted JSON metadata)*

💡 **Tip**: Connect the **Image** output only if you want the preview to be downloaded as a tensor. This saves resources when you don’t need it.

---

## 🖱️ Interface & Controls

### Control Bar

- **NSFW**: `None | Soft | Mature | X`
- **Sort**: `Newest | Most Reactions | Most Comments`
- **Period**: `AllTime | Year | Month | Week | Day`
- **Tags**: list of organized tags
- **Username**: filter by user
- **Apply**: apply filters
- **Batch**: `24 | 50 | 100 | 150` (batch size)
- **Videos only**: display only videos
- **Hide no-prompt**: hide content without prompts
- **Favorites only**: show only favorites
- **Refresh**: reload results

### Grid & Cards

- **★ Favorite**: toggle favorite with one click
- **Open ↗**: open the Civitai page in the browser

### Selection

Click on a card to select:

- **Prompts** (positive/negative)
- **Info JSON**
- **Image/Video** tensor (if output is connected)

---

## 💡 Performance Tips

- **Batch 50–100**: good balance between speed and memory.
- **Videos only**: the first batch is optimized for quick previews.
- **Hide no-prompt**: useful to focus on workflow-ready content.
- **Favorites**: use **Favorites only** mode to build reusable libraries.

---

# 🧹 Clear LoRA Name — Utility Node for ComfyUI

The **Clear LoRA Name** node is a lightweight utility designed to work seamlessly with the **Civitai Discovery Hub** extension. Its purpose is to **clean prompts** by automatically removing any embedded **LoRA tags** of the form `<lora:Some_LoRA_Name:0.7>` or similar variations.

![comfyui_civitai_gallery_001](assets/022907.png)

## 🔧 How it works
- **Inputs**:  
  - `positive_prompt` (optional)  
  - `negative_prompt` (optional)  
- **Process**:  
  - The node parses both prompts.  
  - All `<lora:...>` tags are stripped out.  
  - The remaining text is cleaned to remove extra spaces or artifacts.  
- **Outputs**:  
  - `positive_prompt` (cleaned)  
  - `negative_prompt` (cleaned)  

## 🚀 Why it’s useful with Civitai Discovery Hub
When browsing images in **Civitai Discovery Hub**, many prompts include references to LoRAs that might **not be available locally**. Using these raw prompts in your workflow can trigger errors or produce unexpected results.  
By placing the **Clear LoRA Name** node after the Hub’s prompt outputs:
- You keep the descriptive part of the prompt intact.  
- You remove external dependencies (`<lora:...>`).  
- Your workflow becomes **portable, clean, and reproducible**.  

## 🖥️ UI Features 
- **On/Off toggle**: quickly enable/disable the cleaning process without deleting the node.  
- **Compact and minimal**: fits smoothly into your workflow as a utility step.  

## ✅ Example
**Original prompt from Civitai Discovery Hub**:  
`A cinematic portrait of a warrior <lora:FluxHeroXL:0.8> in a snowy landscape`

**After Clear LoRA Name**:  
`A cinematic portrait of a warrior in a snowy landscape`


---
## ❓ FAQ

**Q. I scroll to the bottom and nothing loads, what should I do?**\
Stay at the bottom: the “near-bottom” mechanism automatically triggers loading. If the network is slow, wait until the current batch finishes (check the status). If it still seems stuck, scroll slightly up and back down to re-trigger.

**Q. Favorites don’t appear immediately in “Favorites only” mode.**\
The list is refreshed automatically, but if there is still a delay, use **Refresh** to sync.

**Q. Why do some videos take time to show a preview?**\
Videos load metadata first. The preview appears after a micro-seek. On slow networks, a fallback forces full loading.

---

## 🔗 Useful Links

- **Repo GitHub** : [ComfyUI-Civitai-Discovery-Hub](https://github.com/Light-x02/ComfyUI-Civitai-Discovery-Hub)
- **Ko-fi** : [https://ko-fi.com/light\_x02](https://ko-fi.com/light_x02)

---

## 🙏 Acknowledgements

Thanks to the ComfyUI community for feedback and suggestions.\
A coffee always helps inspire new [features](https://ko-fi.com/light_x02)[ 👉 ](https://ko-fi.com/light_x02)[Ko-fi](https://ko-fi.com/light_x02).

