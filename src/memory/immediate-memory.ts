export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  senderName: string;
  senderId: string;
  timestamp: number;
  chatId: string;
}

export class ImmediateMemory {
  private messages: Message[] = [];
  private maxSize: number;

  constructor(maxSize: number = 20) {
    this.maxSize = maxSize;
  }

  add(msg: Message): void {
    this.messages.push(msg);
    if (this.messages.length > this.maxSize * 2) {
      this.messages = this.messages.slice(-this.maxSize);
    }
  }

  getWindow(size?: number): Message[] {
    const n = size ?? this.maxSize;
    return this.messages.slice(-n);
  }

  getLastUserMessage(): Message | undefined {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].role === 'user') return this.messages[i];
    }
    return undefined;
  }

  clear(): void {
    this.messages = [];
  }

  size(): number {
    return this.messages.length;
  }
}
