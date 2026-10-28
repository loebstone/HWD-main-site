import { useState } from "react";
import { useForm } from "react-hook-form";
import { getGetContactStatusQueryKey, useGetContactStatus, useSendContact } from "@workspace/api-client-react";
import { PageHeader } from "@/components/page-header";
import { ErrorState, ListSkeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Form } from "@/components/ui/form";
import { errorMessage } from "@/lib/session";

type ContactForm = { subject: string; message: string };

export default function ContactPage() {
  const status = useGetContactStatus({ query: { queryKey: getGetContactStatusQueryKey(), staleTime: 30_000, refetchOnMount: true } });
  const send = useSendContact();
  const form = useForm<ContactForm>({ defaultValues: { subject: "", message: "" } });
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const msgLen = form.watch("message").length;

  async function submit(values: ContactForm) {
    setError(null); setSent(null);
    try {
      const res = await send.mutateAsync({ data: { subject: values.subject.trim(), message: values.message.trim() } });
      setSent(res.message || "Your message was sent.");
      form.reset({ subject: "", message: "" });
    } catch (err) {
      setError(errorMessage(err, "Your message could not be sent. Please try again."));
    }
  }

  return <div>
    <PageHeader eyebrow="Get in touch" title="Contact" intro="Send a note to the people who look after the Farm." />
    {status.isLoading ? <ListSkeleton rows={2} /> : status.isError ? <ErrorState onRetry={() => status.refetch()} /> :
      !status.data?.configured ? <p className="max-w-2xl rounded-xl border bg-card px-5 py-6 text-muted-foreground" data-testid="status-contact-unconfigured">Contact isn't set up yet</p> :
        <section className="max-w-2xl rounded-xl border bg-card p-5 md:p-7">
          {sent && <p className="mb-5 rounded-lg border-l-4 border-primary bg-accent/50 px-4 py-3" role="status" data-testid="status-contact-sent">{sent}</p>}
          <Form {...form}><form className="space-y-5" onSubmit={form.handleSubmit(submit)} data-testid="form-contact">
            <div className="space-y-1.5"><Label htmlFor="contact-subject">Subject</Label>
              <Input id="contact-subject" maxLength={200} {...form.register("subject", { required: true, validate: (v) => !!v.trim() })} data-testid="input-contact-subject" />
              {form.formState.errors.subject && <p className="text-sm text-destructive">Please add a subject.</p>}</div>
            <div className="space-y-1.5"><Label htmlFor="contact-message">Message</Label>
              <Textarea id="contact-message" rows={8} maxLength={5000} {...form.register("message", { required: true, validate: (v) => !!v.trim() })} data-testid="input-contact-message" />
              <div className="flex justify-between text-sm">
                <span className="text-destructive">{form.formState.errors.message ? "Please write a message." : ""}</span>
                <span className="text-muted-foreground" data-testid="text-contact-count">{msgLen} / 5000</span>
              </div></div>
            <Button type="submit" disabled={send.isPending} data-testid="button-send-contact">{send.isPending ? "Sending…" : "Send message"}</Button>
            {error && <p className="text-sm text-destructive" role="alert" data-testid="status-contact-error">{error}</p>}
          </form></Form>
        </section>}
  </div>;
}
