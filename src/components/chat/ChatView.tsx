import { useState, useRef, useEffect } from "react";
import { useDirectMessages } from "@/hooks/useDirectMessages";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useRetryDirectMessage, useSendDirectMessage } from "@/hooks/useSendDirectMessage";
import { DeliveryStatus } from "./DeliveryStatus";
import { deliveryStatusText } from "@/lib/dmDelivery";
import { useAuthor } from "@/hooks/useAuthor";
import { useToast } from "@/hooks/useToast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { genUserName } from "@/lib/genUserName";
import { Send, Loader2, Lock, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface ChatViewProps {
  otherUserPubkey: string;
}

export function ChatView({ otherUserPubkey }: ChatViewProps) {
  const { user } = useCurrentUser();
  const { data: messages, isLoading } = useDirectMessages(otherUserPubkey);
  const { data: otherUser } = useAuthor(otherUserPubkey);
  const { mutateAsync: sendMessage, isPending: isSending } = useSendDirectMessage();
  const { mutate: retryDelivery, isPending: isRetrying, variables: retryingDelivery } = useRetryDirectMessage();
  const { toast } = useToast();
  
  const [newMessage, setNewMessage] = useState("");
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  const otherUserMetadata = otherUser?.metadata;
  const otherUserName = otherUserMetadata?.name || otherUserMetadata?.display_name || genUserName(otherUserPubkey);

  // Keep the newest message in view by scrolling the message pane only (not the page)
  // (re-run when the conversation or its newest message changes, not just the count,
  // which stays the same once the history limit is reached)
  const newestMessageId = messages?.[messages.length - 1]?.id;
  useEffect(() => {
    const viewport = scrollAreaRef.current?.querySelector<HTMLElement>('[data-radix-scroll-area-viewport]');
    if (viewport) viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'smooth' });
  }, [otherUserPubkey, newestMessageId]);

  const handleSendMessage = async () => {
    if (!user || !newMessage.trim()) return;

    if (isSending) return;
    try {
      const delivery = await sendMessage({ recipient: otherUserPubkey, message: newMessage.trim() });

      // The message now shows in the conversation with its delivery state and any retry action
      setNewMessage(current => current === newMessage ? "" : current);
      if (delivery.recipient.status === 'failed') {
        toast({ title: 'Message not delivered', description: deliveryStatusText(delivery).text, variant: 'destructive' });
      }
    } catch (error) {
      console.error('Error sending message:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to send message. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Don't send while an IME composition (e.g. Japanese, Chinese input) is in progress
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  if (!user) {
    return (
      <Card>
        <CardContent className="py-12 px-8 text-center">
          <Lock className="h-8 w-8 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold mb-2">Login Required</h3>
          <p className="text-muted-foreground">
            Please log in to access your messages
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100dvh-14rem)] min-h-[420px] lg:h-[600px] max-w-2xl mx-auto">
      {/* Chat Header */}
      <Card className="rounded-b-none border-b-0">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-3">
            <Avatar className="h-10 w-10">
              <AvatarImage src={otherUserMetadata?.picture} alt={otherUserName} />
              <AvatarFallback>
                {otherUserName.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div>
              <h3 className="text-lg font-semibold">{otherUserName}</h3>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Lock className="h-3 w-3" />
                <span title="New messages are sent as NIP-17 gift wraps when your signer supports NIP-44, which hides who you message and when. Older or fallback NIP-04 messages only encrypt the text.">Private messages</span>
              </div>
            </div>
          </CardTitle>
        </CardHeader>
      </Card>

      {/* Messages Area */}
      <Card className="flex-1 min-h-0 overflow-hidden rounded-none border-b-0">
        <CardContent className="p-0 h-full">
          <ScrollArea className="h-full p-4" ref={scrollAreaRef}>
            {isLoading ? (
              <div className="space-y-4">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className={cn("flex", i % 2 === 0 ? "justify-end" : "justify-start")}>
                    <div className="space-y-2 max-w-xs">
                      <Skeleton className="h-4 w-24" />
                      <Skeleton className="h-16 w-48" />
                    </div>
                  </div>
                ))}
              </div>
            ) : messages && messages.length > 0 ? (
              <div className="space-y-4">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={cn(
                      "flex",
                      message.isFromMe ? "justify-end" : "justify-start"
                    )}
                  >
                    <div
                      className={cn(
                        "max-w-xs lg:max-w-md px-4 py-2 rounded-lg",
                        message.isFromMe
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted",
                        message.decryptError && "border border-destructive"
                      )}
                    >
                      {message.decryptError && (
                        <div className="flex items-center gap-1 text-destructive mb-1">
                          <AlertCircle className="h-3 w-3" />
                          <span className="text-xs">Decryption failed</span>
                        </div>
                      )}
                      <p className="text-sm whitespace-pre-wrap break-words">
                        {message.content}
                      </p>
                      {message.delivery && (
                        <DeliveryStatus
                          delivery={message.delivery}
                          onRetry={() => message.delivery && retryDelivery(message.delivery)}
                          retrying={isRetrying && retryingDelivery === message.delivery}
                          className="text-primary-foreground/90"
                        />
                      )}
                      <p
                        className={cn(
                          "text-xs mt-1",
                          message.isFromMe
                            ? "text-primary-foreground/70"
                            : "text-muted-foreground"
                        )}
                      >
                        {new Date(message.created_at * 1000).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <div className="text-4xl mb-4">💬</div>
                  <h3 className="text-lg font-semibold mb-2">Start a conversation</h3>
                  <p className="text-muted-foreground">
                    Send a message to begin your encrypted chat with {otherUserName}
                  </p>
                </div>
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Message Input */}
      <Card className="rounded-t-none">
        <CardContent className="p-4">
          <div className="flex gap-2">
            <Textarea
              placeholder="Type your message..."
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              aria-label={`Message ${otherUserName}`}
              className="flex-1 min-h-[40px] max-h-[120px] resize-none"
              rows={1}
            />
            <Button
              onClick={handleSendMessage}
              disabled={isSending || !newMessage.trim()}
              size="sm"
              className="self-end"
              aria-label="Send message"
            >
              {isSending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Press Enter to send, Shift+Enter for new line
          </p>
        </CardContent>
      </Card>
    </div>
  );
}