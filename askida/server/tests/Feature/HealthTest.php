<?php

it('answers the health route with 200', function () {
    $this->get('/up')->assertOk();
});
