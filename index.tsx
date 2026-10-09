/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChatBarButton } from "@api/ChatButtons";
import { openModal } from "@utils/modal";
import definePlugin from "@utils/types";
import { findByPropsLazy, findStoreLazy } from "@webpack";
import { MessageStore, RestAPI, SelectedChannelStore, UserStore, useStateFromStores } from "@webpack/common";
import { EditorModal } from "./EditorModal";
import { eraseStop } from "./erase";
import { settings } from "./settings";
const UploadAttachmentStore = findStoreLazy("UploadAttachmentStore");
const UploadManager = findByPropsLazy("addFile", "clearAll");
const DRAFT_TYPE = 0; 
const GEAR_PATH = "M10.56 1.1c-.46.05-.7.53-.64.98.18 1.16-.19 2.2-.98 2.53-.8.33-1.79-.15-2.49-1.1-.27-.36-.78-.52-1.14-.24-.77.59-1.45 1.27-2.04 2.04-.28.36-.12.87.24 1.14.96.7 1.43 1.7 1.1 2.49-.33.8-1.37 1.16-2.53.98-.45-.07-.93.18-.99.64a11.1 11.1 0 0 0 0 2.88c.06.46.54.7.99.64 1.16-.18 2.2.19 2.53.98.33.8-.14 1.79-1.1 2.49-.36.27-.52.78-.24 1.14.59.77 1.27 1.45 2.04 2.04.36.28.87.12 1.14-.24.7-.95 1.7-1.43 2.49-1.1.8.33 1.16 1.37.98 2.53-.07.45.18.93.64.99a11.1 11.1 0 0 0 2.88 0c.46-.06.7-.54.64-.99-.18-1.16.19-2.2.98-2.53.8-.33 1.79.14 2.49 1.1.27.36.78.52 1.14.24.77-.59 1.45-1.27 2.04-2.04.28-.36.12-.87-.24-1.14-.96-.7-1.43-1.7-1.1-2.49.33-.8 1.37-1.16 2.53-.98.45.07.93-.18.99-.64a11.1 11.1 0 0 0 0-2.88c-.06-.46-.54-.7-.99-.64-1.16.18-2.2-.19-2.53-.98-.33-.8.14-1.79 1.1-2.49.36-.27.52-.78.24-1.14a11.07 11.07 0 0 0-2.04-2.04c-.36-.28-.87-.12-1.14.24-.7.96-1.7 1.43-2.49 1.1-.8-.33-1.16-1.37-.98-2.53.07-.45-.18-.93-.64-.99a11.1 11.1 0 0 0-2.88 0ZM16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z";
type Upload = { id: string; filename: string; item: { file: File; }; };

function download(file: File) {
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url;
    a.download = "edited-" + file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
}

const isImage = (u: Upload) =>
    !!u.item?.file && (u.item.file.type.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|avif)$/i.test(u.filename ?? ""));

function addToComposer(file: File): boolean {
    const channelId = SelectedChannelStore.getChannelId();
    try {
        UploadManager.addFile({ file: { file, platform: 1 }, isClip: false, isThumbnail: false, channelId, showLargeMessageDialog: false, draftType: DRAFT_TYPE });
        return true;
    } catch {
        download(file);
        return false;
    }
}

function replaceUpload(old: Upload, edited: File) {
    if (addToComposer(edited)) {
        try {
            UploadManager.remove(SelectedChannelStore.getChannelId(), old.id, DRAFT_TYPE);
        } catch { /* the original just stays in the list */ }
    }
}

function openSettings(up: Upload) {
    openModal(props => <EditorModal modalProps={props} file={up.item.file} onSave={f => replaceUpload(up, f)} />);
}

type FoundMessage = { message: any; channelId: string; attachmentId: string; };
function findMessageByAttachmentUrl(url: string): FoundMessage | null {
    try {
        const m = new URL(url).pathname.match(/\/attachments\/(\d+)\/(\d+)\//);
        if (!m) return null;
        const [, channelId, attachmentId] = m;
        const msgs: any[] = (MessageStore as any).getMessages(channelId)?.toArray?.() ?? [];
        const message = msgs.find(msg => msg.attachments?.some((a: any) => a.id === attachmentId));
        return message ? { message, channelId, attachmentId } : null;
    } catch { return null; }
}

async function replaceInMessage({ message, channelId, attachmentId }: FoundMessage, edited: File) {
    const keep = message.attachments
        .filter((a: any) => a.id !== attachmentId)
        .map((a: any) => ({ id: a.id }));
    const form = new FormData();
    form.append("payload_json", JSON.stringify({
        attachments: [...keep, { id: 0, filename: edited.name }]
    }));
    form.append("files[0]", edited, edited.name);
    await RestAPI.patch({ url: `/channels/${channelId}/messages/${message.id}`, body: form });
}

async function openRemote(url: string) {
    try {
        const blob = await (await fetch(url)).blob();
        const name = decodeURIComponent(new URL(url).pathname.split("/").pop() || "image.png");
        const file = new File([blob], name, { type: blob.type || "image/png" });
        const found = findMessageByAttachmentUrl(url);
        const isOwn = !!found && found.message.author?.id === UserStore.getCurrentUser().id;

        openModal(props => (
            <EditorModal
                modalProps={props}
                file={file}
                onSave={async (f: File) => {
                    if (found && isOwn) {
                        try { await replaceInMessage(found, f); return;
                        } catch (e) { console.error("[AttachmentEditor] message edit failed", e); }
                    }
                    addToComposer(f);
                }}
            />
        ));
    } catch (e) {
        console.error("[AttachmentEditor] could not load image", e);
        window.open(url, "_blank");
    }
}

const GearIcon = ({ className, size = 18 }: { className?: string; size?: number; }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
        <path fill="currentColor" fillRule="evenodd" clipRule="evenodd" d={GEAR_PATH} />
    </svg>
);

function ChatBarGear({ channelId }: { channelId: string; }) {
    const images = useStateFromStores(
        [UploadAttachmentStore],
        () => {
            try {
                return ((UploadAttachmentStore.getUploads(channelId, DRAFT_TYPE) ?? []) as Upload[]).filter(isImage);
            } catch (e) {
                console.error("[AttachmentEditor] getUploads failed", e);
                return [] as Upload[];
            }
        },
        [channelId]
    );
    if (!images.length) return null;
    return (
        <ChatBarButton tooltip="Attachment Settings" onClick={() => openSettings(images[images.length - 1])}>
            <GearIcon />
        </ChatBarButton>
    );
}

export default definePlugin({
    name: "AttachmentEditor",
    description: "Edit image attachments before sending or after sending. Click the gear icon on an image to open the editor.",
    authors: [{ name: "cyrodev", id: 921065758526681088n }], 
    settings,
    restartNeeded: true,
    patches: [
        {
            find: ".attachmentItemSmall]",
            replacement: {
                match: /\(0,\i\.jsx\)\((\i)\.A,\{className:(\i\(\)\(\{\[\i\.action\]:\i\}\)),tooltip:\i\?\i\.intl\.string\(\i\.default\.V8YlF7\).{0,250}?PencilIcon,\{size:"xs",color:"currentColor",className:(\i\(\)\(\{\[\i\.actionBarIcon\]:\i\}\))\}\)\}\):null,(?=.+?draftType:\i,id:(\i)\.id,channelId:\i,)/,
                replace: "$&$self.renderGear($4,$1.A,$2,$3),"  }
        },
        {
            find: "let{mimeType:",
            replacement: {
                match: /function \i\(\i\)\{let\{mimeType:(\i),downloadURL:(\i),.{0,500}?(\i)=\[\];.{0,100}?\(0,(\i)\.jsx\)\((\i\.\i),\{text:\i\.intl\.string\(\i\.t\.Y8ujqr\),children:\(0,\4\.jsx\)\((\i\.\i),\{className:(\i\.\i),.{0,400}?(?=null!=\i&&\3\.push\()/,
                replace: "$&$self.addGear($3,$1,$2,$5,$6,$7),"  }
        }
    ],
    addGear(arr: any[], mimeType: string[] | undefined, url: string | undefined, Tip: any, Btn: any, className: string) {
        if (!url || mimeType?.[0] !== "image") return;
        arr.push(
            <Tip key="attachment-settings" text="Attachment Settings">
                <Btn className={className} focusProps={{ offset: 2 }} onClick={() => openRemote(url)} aria-label="Attachment Settings">
                    <GearIcon size={20} />
                </Btn>
            </Tip>
        );
    },
    renderGear(upload: Upload, Button: any, className: string, iconClassName: string) {
        if (!upload || !isImage(upload)) return null;
        return (
            <Button
                key="attachment-settings"
                className={className}
                tooltip="Attachment Settings"
                onClick={() => openSettings(upload)}
            >
                <GearIcon className={iconClassName} />
            </Button>
        );
    },
    chatBarButton: {
        icon: () => <GearIcon />,
        render({ channel, type }: any) {
            if (type?.analyticsName === "edit") return null;
            return <ChatBarGear channelId={channel.id} />;
        }
    },
    stop() {
        void eraseStop();
    }
});