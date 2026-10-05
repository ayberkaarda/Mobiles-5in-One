<?php

namespace Tests;

use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use Livewire\Livewire;

abstract class TestCase extends BaseTestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        // Livewire keeps static state across the tests of one process: after an admin panel
        // test it would inject its style and script tags into every later HTML response,
        // including the public pages that must ship none. Reset it before every test.
        Livewire::flushState();
    }
}
