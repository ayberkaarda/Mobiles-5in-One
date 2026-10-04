@component('mail.layout', ['title' => 'Esnaf ödemeleri bekletmeye alındı'])
    <p>Dolandırıcılık taraması bir esnafın bekleyen ödemelerini otomatik olarak bekletmeye aldı. İnceleme yönetim panelinde, kötüye kullanım kayıtları bölümünde.</p>
    <ul>
        <li>Esnaf kimliği: {{ $shopId }}</li>
        <li>Kayıt kimliği: {{ $flagId }}</li>
        <li>Tür: {{ $kind }}</li>
        @foreach ($detail as $name => $value)
            <li>{{ $name }}: {{ $value }}</li>
        @endforeach
    </ul>
    <p>Bekletme yalnızca finans ekibi tarafından, gerekçe yazılarak kaldırılabilir.</p>
@endcomponent
