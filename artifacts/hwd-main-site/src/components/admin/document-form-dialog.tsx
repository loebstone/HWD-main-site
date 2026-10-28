import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateLinkDocument, useUploadDocument, useUpdateDocument, useReplaceDocument,
  getListDocumentsQueryKey, getGetHomeQueryKey, Section,
  type Document, type DocumentInput,
} from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { SECTION_LABELS, YEAR_REQUIRED } from "@/lib/docs";
import { errorMessage } from "@/lib/session";

export type FormMode = "upload" | "link" | "edit" | "replace";
const MAX_BYTES = 50 * 1024 * 1024;

const TITLES: Record<FormMode, string> = {
  upload: "Upload a PDF", link: "Add a link", edit: "Edit details", replace: "Replace document",
};

export function DocumentFormDialog({ mode, doc, open, onOpenChange }: {
  mode: FormMode; doc?: Document; open: boolean; onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const createLink = useCreateLinkDocument();
  const upload = useUploadDocument();
  const update = useUpdateDocument();
  const replace = useReplaceDocument();

  const [title, setTitle] = useState("");
  const [section, setSection] = useState<Section>("shareholders");
  const [year, setYear] = useState("");
  const [type, setType] = useState<"pdf" | "link">("pdf");
  const [url, setUrl] = useState("");
  const [sortOrder, setSortOrder] = useState("0");
  const [tags, setTags] = useState("");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null); setFile(null);
    setTitle(doc?.title ?? ""); setSection(doc?.section ?? "shareholders");
    setYear(doc?.year != null ? String(doc.year) : "");
    setType(mode === "link" ? "link" : mode === "upload" ? "pdf" : doc?.type ?? "pdf");
    setUrl(doc?.externalUrl ?? ""); setSortOrder(String(doc?.sortOrder ?? 0));
    setTags(doc?.tags.join(", ") ?? ""); setNote(doc?.note ?? "");
  }, [open, mode, doc]);

  const needsFile = (mode === "upload") || (mode === "replace" && type === "pdf");
  const showType = mode === "replace";
  const showUrl = type === "link" && mode !== "upload";

  function build(): DocumentInput | string {
    const t = title.trim();
    if (!t) return "Give it a title.";
    if (t.length > 250) return "Title is too long (250 characters max).";
    let y: number | null = null;
    if (year.trim()) {
      y = Number(year);
      if (!Number.isInteger(y) || y < 1800 || y > 2200) return "Year should be between 1800 and 2200.";
    } else if (YEAR_REQUIRED.includes(section)) return "Meeting documents need a year.";
    const so = Number(sortOrder || 0);
    if (!Number.isFinite(so) || !Number.isInteger(so)) return "Sort order should be a whole number.";
    const tagList = tags.split(",").map((s) => s.trim()).filter(Boolean);
    if (tagList.length > 30 || tagList.some((s) => s.length > 80)) return "Up to 30 tags, 80 characters each.";
    if (note.length > 2000) return "Note is too long (2000 characters max).";
    if (showUrl) {
      try { const u = new URL(url.trim()); if (!/^https?:$/.test(u.protocol)) throw 0; }
      catch { return "Enter a full web address starting with https://"; }
    }
    if (needsFile) {
      if (!file) return "Choose a PDF file.";
      if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) return "Only PDF files can be uploaded.";
      if (file.size > MAX_BYTES) return "That PDF is larger than 50 MB.";
    }
    return {
      title: t, section, year: y, type, externalUrl: type === "link" ? url.trim() : null,
      sortOrder: so, tags: tagList, note,
    };
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const input = build();
    if (typeof input === "string") { setError(input); return; }
    setError(null); setBusy(true);
    try {
      if (mode === "link") await createLink.mutateAsync({ data: input });
      else if (mode === "upload") await upload.mutateAsync({ data: { metadata: JSON.stringify(input), file: file! } });
      else if (mode === "edit") await update.mutateAsync({ id: doc!.id, data: { ...input, type: doc!.type, externalUrl: doc!.type === "link" ? input.externalUrl : null } });
      else await replace.mutateAsync({ id: doc!.id, data: { metadata: JSON.stringify(input), ...(type === "pdf" && file ? { file } : {}) } });
      await Promise.all([
        qc.invalidateQueries({ queryKey: getListDocumentsQueryKey() }),
        qc.invalidateQueries({ queryKey: getGetHomeQueryKey() }),
      ]);
      toast({ title: "Saved", description: input.title });
      onOpenChange(false);
    } catch (err) {
      setError(errorMessage(err, "Saving failed. Please try again."));
    } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-w-lg max-h-[92dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">{TITLES[mode]}</DialogTitle>
          <DialogDescription>
            {mode === "replace" ? "The current version is kept on record and the new one takes its place." : "Members will see this in the section you choose."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="f-title">Title</Label>
            <Input id="f-title" value={title} onChange={(e) => setTitle(e.target.value)} data-testid="input-title" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5 col-span-2 sm:col-span-1">
              <Label>Section</Label>
              <Select value={section} onValueChange={(v) => setSection(v as Section)}>
                <SelectTrigger data-testid="select-section"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.values(Section).map((s) => <SelectItem key={s} value={s}>{SECTION_LABELS[s]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="f-year">Year{YEAR_REQUIRED.includes(section) ? "" : " (optional)"}</Label>
              <Input id="f-year" inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value)} data-testid="input-year" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="f-sort">Sort order</Label>
              <Input id="f-sort" inputMode="numeric" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} data-testid="input-sort-order" />
            </div>
          </div>
          {showType && (
            <div className="space-y-1.5">
              <Label>Replace with</Label>
              <Select value={type} onValueChange={(v) => setType(v as "pdf" | "link")}>
                <SelectTrigger data-testid="select-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pdf">A new PDF</SelectItem>
                  <SelectItem value="link">A link</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          {showUrl && (
            <div className="space-y-1.5">
              <Label htmlFor="f-url">Web address</Label>
              <Input id="f-url" type="url" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} data-testid="input-url" />
            </div>
          )}
          {needsFile && (
            <div className="space-y-1.5">
              <Label htmlFor="f-file">PDF file (up to 50 MB)</Label>
              <Input id="f-file" type="file" accept="application/pdf,.pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} data-testid="input-file" />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="f-tags">Tags, separated by commas</Label>
            <Input id="f-tags" value={tags} onChange={(e) => setTags(e.target.value)} data-testid="input-tags" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="f-note">Note</Label>
            <Textarea id="f-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} data-testid="input-note" />
          </div>
          {error && <p className="text-sm text-destructive" data-testid="text-form-error">{error}</p>}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
            <Button type="submit" disabled={busy} data-testid="button-save-document">{busy ? "Saving..." : "Save"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
