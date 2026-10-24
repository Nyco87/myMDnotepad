// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api", () => ({
  saveImage: vi.fn(async () => "images/n-2026-10-24-1.png"),
  importImage: vi.fn(async () => "images/x-2026-10-24-1.png"),
  resolveAsset: (rel: string) => `asset://${rel}`,
}));

import { saveImage } from "../api";
import { imageAssetPath, imagePastePlugin, imageNodeView } from "./images";
import { makeEditor } from "./test-helpers";

function pasteEvent(files: { type: string }[]): ClipboardEvent {
  const blobFiles = files.map((f) => ({
    type: f.type,
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
  }));
  return { clipboardData: { files: blobFiles }, preventDefault: vi.fn() } as unknown as ClipboardEvent;
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
});
