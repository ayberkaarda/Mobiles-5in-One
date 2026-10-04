<?php

namespace App\Domain\Push;

/**
 * A push notification: Turkish title and body plus string data. Messages carry no
 * recipient identity, code, device data or location (rules AN-1, AN-7).
 */
final readonly class PushMessage
{
    /**
     * @param  array<string, string>  $data
     */
    public function __construct(
        public string $title,
        public string $body,
        public array $data = [],
    ) {}

    /**
     * @return array{title: string, body: string, data: array<string, string>}
     */
    public function toArray(): array
    {
        return ['title' => $this->title, 'body' => $this->body, 'data' => $this->data];
    }
}
