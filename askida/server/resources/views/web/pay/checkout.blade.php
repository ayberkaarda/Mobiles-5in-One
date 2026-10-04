@extends('web.pay.layout')

@section('title', 'Ödeme')

@section('content')
    <h1>Askıya bırak</h1>
    <dl>
        <dt>Dükkân</dt><dd>{{ $shop }}</dd>
        <dt>Ürün</dt><dd>{{ $item }}</dd>
        <dt>Adet</dt><dd>{{ $qty }}</dd>
        <dt class="total">Toplam</dt><dd class="total">{{ $amount }}</dd>
        <dt>Esnafa giden</dt><dd>{{ $net }}</dd>
        <dt>Platform komisyonu</dt><dd>{{ $commission }}</dd>
    </dl>
    <p class="note">Ödeme, ödeme kuruluşu üzerinden doğrudan esnafın hesabına aktarılır. Askıda yalnızca platform komisyonunu alır.</p>
    <section aria-label="Ödeme formu">
        {!! $checkout !!}
    </section>
@endsection
