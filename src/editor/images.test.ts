// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api", () => ({
  saveImage: vi.fn(async () => "images/n-2026-10-24-1.png"),
  importImage: vi.fn(async () => "images/x-2026-10-24-1.png"),
  resolveAsset: (rel: string) => `asset://${rel}`,
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(async () => "C:\\Users\\me\\photo.png") }));

import { saveImage } from "../api";
import { imageAssetPath, imagePastePlugin, imageNodeView, pickAndInsertImage } from "./images";
import { makeEditor } from "./test-helpers";

function pasteEvent(files: { type: string }[], types: string[] = ["Files"]): ClipboardEvent {
  const blobFiles = files.map((f) => ({
    type: f.type,
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
  }));
  return { clipboardData: { files: blobFiles, types }, preventDefault: vi.fn() } as unknown as ClipboardEvent;
}

beforeEach(() => vi.mocked(saveImage).mockClear());

describe("imageAssetPath", () => {
  it("joins relative links to the note folder and normalizes dot segments", () => {
    expect(imageAssetPath("a.md", "images/x.png")).toBe("images/x.png");
    expect(imageAssetPath("proj/a.md", "images/x.png")).toBe("proj/images/x.png");
    expect(imageAssetPath("proj/sub/a.md", "../img/x y.png")).toBe("proj/img/x y.png");
    expect(imageAssetPath("a.md", "./images/x.png")).toBe("images/x.png");
  });
  it("leaves absolute http(s) urls alone (null)", () => {
    expect(imageAssetPath("a.md", "https://e.com/x.png")).toBeNull();
    expect(imageAssetPath("a.md", "data:image/png;base64,AA")).toBeNull();
  });
  it("normalizes backslashes and ignores Windows absolute paths", () => {
    expect(imageAssetPath("proj\\a.md", "images\\x.png")).toBe("proj/images/x.png");
    expect(imageAssetPath("a.md", "C:\\pics\\x.png")).toBeNull();
  });
});

describe("imagePastePlugin", () => {
  it("paste_image_inserts_node", async () => {
    const ed = makeEditor("hello\n");
    const plugin = imagePastePlugin(() => "n.md");
    const handled = plugin.props.handlePaste!.call(plugin, ed.view, pasteEvent([{ type: "image/png" }]), null as never);
    expect(handled).toBe(true);
    await vi.waitFor(() => expect(ed.getMarkdown()).toContain("![](images/n-2026-10-24-1.png)"));
    expect(saveImage).toHaveBeenCalledWith("n.md", expect.any(Uint8Array), "png");
    let src = "";
    ed.view.state.doc.descendants((n) => {
      if (n.type.name === "image") src = n.attrs.src;
    });
    expect(src).toBe("images/n-2026-10-24-1.png");
  });

  it("paste_text_is_not_intercepted", () => {
    const ed = makeEditor("hello\n");
    const plugin = imagePastePlugin(() => "n.md");
    expect(plugin.props.handlePaste!.call(plugin, ed.view, pasteEvent([]), null as never)).toBe(false);
    expect(plugin.props.handlePaste!.call(plugin, ed.view, pasteEvent([{ type: "text/plain" }]), null as never)).toBe(false);
    expect(saveImage).not.toHaveBeenCalled();
  });

  it("mixed text + bitmap paste keeps the text (not intercepted)", () => {
    const ed = makeEditor("hello\n");
    const plugin = imagePastePlugin(() => "n.md");
    const ev = pasteEvent([{ type: "image/png" }], ["text/html", "text/plain", "Files"]);
    expect(plugin.props.handlePaste!.call(plugin, ed.view, ev, null as never)).toBe(false);
    expect(saveImage).not.toHaveBeenCalled();
  });

  it("uses the note captured at paste time and reports errors through onError", async () => {
    const ed = makeEditor("hello\n");
    let note = "a.md";
    const onError = vi.fn();
    vi.mocked(saveImage).mockRejectedValueOnce(new Error("boom"));
    const plugin = imagePastePlugin(() => note, onError);
    plugin.props.handlePaste!.call(plugin, ed.view, pasteEvent([{ type: "image/png" }]), null as never);
    note = "b.md";
    await vi.waitFor(() => expect(onError).toHaveBeenCalled());
    expect(saveImage).toHaveBeenCalledWith("a.md", expect.any(Uint8Array), "png");
  });
});

describe("imageNodeView", () => {
  it("resolves relative src through resolveAsset and falls back to a placeholder on error", () => {
    const ed = makeEditor("![alt](images/a.png)\n");
    let node!: import("prosemirror-model").Node;
    ed.view.state.doc.descendants((n) => {
      if (n.type.name === "image") node = n;
    });
    const nv = imageNodeView(() => "proj/n.md")(node, ed.view, () => 0, [], null as never);
    const img = nv.dom.querySelector("img") ?? (nv.dom as HTMLImageElement);
    expect(img.getAttribute("src")).toBe("asset://proj/images/a.png");
    img.dispatchEvent(new Event("error"));
    expect(nv.dom.classList.contains("img-broken")).toBe(true);
    expect(nv.dom.textContent).toContain("alt");
  });

  it("placeholder label of a broken backslash src is the file name", () => {
    const ed = makeEditor("![](a.png)\n");
    let node!: import("prosemirror-model").Node;
    ed.view.state.doc.descendants((n) => {
      if (n.type.name === "image") node = n;
    });
    const fake = node.type.create({ src: "C:\\pics\\photo.png", alt: "" });
    const nv = imageNodeView(() => "n.md")(fake, ed.view, () => 0, [], null as never);
    nv.dom.querySelector("img")!.dispatchEvent(new Event("error"));
    expect(nv.dom.textContent).toBe("photo.png");
  });
});

describe("pickAndInsertImage", () => {
  it("uses the file base name as alt for a Windows backslash path", async () => {
    const ed = makeEditor("hello\n");
    await pickAndInsertImage(ed.view, "n.md");
    expect(ed.getMarkdown()).toContain("![photo](images/x-2026-10-24-1.png)");
  });
});
