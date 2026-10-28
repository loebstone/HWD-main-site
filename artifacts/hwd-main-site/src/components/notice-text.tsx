export function NoticeText({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return <span className="whitespace-pre-wrap">{parts.map((part, index) =>
    /^https?:\/\//.test(part)
      ? <a key={index} href={part} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-4 break-all" data-testid={`link-notice-${index}`}>{part}</a>
      : part
  )}</span>;
}
