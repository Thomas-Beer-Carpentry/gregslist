"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
export function PhotoUploader({
  postId,
  count,
}: {
  postId: string;
  count: number;
}) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const upload = useRef<XMLHttpRequest | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!file) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(() => () => upload.current?.abort(), []);
  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setMessage("Photos must be no larger than 5 MB.");
      return;
    }
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setMessage("Choose a JPEG, PNG or WebP photo.");
      return;
    }
    const xhr = new XMLHttpRequest();
    upload.current = xhr;
    xhr.open("POST", `/api/posts/${postId}/photos`);
    setProgress(0);
    setMessage("");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable)
        setProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onerror = () => {
      setProgress(null);
      setMessage("Upload interrupted. Please try again.");
    };
    xhr.onload = () => {
      setProgress(null);
      if (xhr.status === 201) {
        setFile(null);
        if (input.current) input.current.value = "";
        setMessage("Photo added.");
        router.refresh();
      } else {
        try {
          setMessage(
            JSON.parse(xhr.responseText).error ||
              "Could not upload this photo.",
          );
        } catch {
          setMessage("Could not upload this photo. Please try again.");
        }
      }
    };
    const data = new FormData();
    data.append("photo", file);
    xhr.send(data);
  }
  return (
    <form onSubmit={submit} className="upload-panel">
      <label htmlFor="photo">Add a photo</label>
      <p id="photo-help" className="muted">
        JPEG, PNG or WebP, up to 5 MB. {count}/6 photos. Location metadata is
        removed.
      </p>
      <input
        ref={input}
        id="photo"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        aria-describedby={message ? "photo-help photo-feedback" : "photo-help"}
        disabled={progress !== null || count >= 6}
        onChange={(e) => {
          setFile(e.target.files?.[0] || null);
          setMessage("");
        }}
      />
      {preview && (
        <img
          className="photo-preview"
          src={preview}
          alt="Selected photo preview"
          width={320}
          height={160}
          decoding="async"
        />
      )}
      {progress !== null && (
        <div role="status">
          <progress
            max="100"
            value={progress}
            aria-label="Photo upload progress"
          />
          <span>
            {progress === 100 ? "Processing photo…" : `Uploading ${progress}%`}
          </span>
        </div>
      )}
      {message && (
        <p id="photo-feedback" role="status" className="message">
          {message}
        </p>
      )}
      <Button disabled={!file || progress !== null || count >= 6} type="submit">
        {progress !== null ? "Uploading…" : "Upload photo"}
      </Button>
    </form>
  );
}
