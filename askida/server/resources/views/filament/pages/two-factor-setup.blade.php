<x-filament-panels::page>
    @if ($this->isConfirmed())
        <x-filament::section>
            <x-slot name="heading">Kurtarma kodları</x-slot>
            <x-slot name="description">
                Doğrulayıcı uygulamanıza erişemezseniz bu kodlardan biriyle giriş yapabilirsiniz. Her kod bir kez kullanılır.
                Kodlar yalnızca şimdi gösterilir; güvenli bir yere kaydedin.
            </x-slot>

            <ul class="grid grid-cols-2 gap-2 font-mono text-sm" data-recovery-codes>
                @foreach ($recoveryCodes as $recoveryCode)
                    <li>{{ $recoveryCode }}</li>
                @endforeach
            </ul>

            <div class="mt-6">
                <x-filament::button tag="a" :href="$this->dashboardUrl()">
                    Kodları kaydettim, panele geç
                </x-filament::button>
            </div>
        </x-filament::section>
    @else
        <x-filament::section>
            <x-slot name="heading">Doğrulayıcı uygulamayı bağlayın</x-slot>
            <x-slot name="description">
                Panelin hiçbir sayfası iki adımlı doğrulama kurulmadan açılmaz. Kodu bir doğrulayıcı uygulamayla tarayın
                ya da anahtarı elle girin, ardından uygulamanın gösterdiği 6 haneli kodu yazın.
            </x-slot>

            <div class="flex flex-col gap-6 md:flex-row md:items-start">
                <img src="{{ $this->qrCodeDataUri() }}" alt="Doğrulayıcı uygulama için QR kodu" width="240" height="240">

                <div class="flex flex-col gap-4">
                    <div>
                        <p class="text-sm text-gray-600 dark:text-gray-400">Elle giriş anahtarı</p>
                        <p class="font-mono text-sm" data-manual-secret>{{ $this->manualSecret() }}</p>
                    </div>

                    <form wire:submit="confirm" class="flex flex-col gap-3">
                        <label for="two-factor-code" class="text-sm font-medium">Doğrulama kodu</label>
                        <x-filament::input.wrapper :valid="! $errors->has('code')">
                            <x-filament::input
                                id="two-factor-code"
                                type="text"
                                inputmode="numeric"
                                autocomplete="one-time-code"
                                maxlength="6"
                                wire:model="code"
                            />
                        </x-filament::input.wrapper>
                        @error('code')
                            <p class="text-sm text-danger-600">{{ $message }}</p>
                        @enderror
                        <x-filament::button type="submit">Doğrula ve etkinleştir</x-filament::button>
                    </form>
                </div>
            </div>
        </x-filament::section>
    @endif
</x-filament-panels::page>
