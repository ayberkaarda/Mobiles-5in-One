<?php

namespace App\Http\Controllers\Web\Content;

use App\Domain\Web\Content\LlmsDocument;
use App\Http\Controllers\Controller;
use Illuminate\Http\Response;

/**
 * `/llms.txt` and `/llms-full.txt`: plain-text summaries of the site for crawlers.
 */
final class LlmsController extends Controller
{
    public function __construct(private readonly LlmsDocument $document) {}

    public function short(): Response
    {
        return $this->text($this->document->short());
    }

    public function full(): Response
    {
        return $this->text($this->document->full());
    }

    private function text(string $body): Response
    {
        return response($body, 200, ['Content-Type' => 'text/plain; charset=utf-8']);
    }
}
