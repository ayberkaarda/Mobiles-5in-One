using Patika.App.Core.Media;

namespace Patika.App.Media;

/// <summary>
/// <see cref="IPhotoPicker"/> over MAUI's <c>MediaPicker</c>: the system camera app or the Android photo
/// picker, so the app itself never reads the gallery. What comes back is only opened, never kept; the
/// Core pipeline re-encodes and strips it before anything is uploaded.
/// </summary>
public sealed class MauiPhotoPicker : IPhotoPicker
{
    public const string CameraDeniedText = "Kamera izni verilmedi. Galeriden bir fotoğraf seçebilirsin.";

    public bool CanCapture => MediaPicker.Default.IsCaptureSupported;

    public async Task<PickedPhoto?> CaptureAsync(CancellationToken ct = default)
    {
        try
        {
            var file = await MainThread.InvokeOnMainThreadAsync(() => MediaPicker.Default.CapturePhotoAsync(
                new MediaPickerOptions { Title = "İstasyonun fotoğrafı" }));
            return Wrap(file);
        }
        catch (PermissionException e)
        {
            throw new PhotoException(CameraDeniedText, e);
        }
    }

    public async Task<PickedPhoto?> PickAsync(CancellationToken ct = default)
    {
        var files = await MainThread.InvokeOnMainThreadAsync(() => MediaPicker.Default.PickPhotosAsync(
            new MediaPickerOptions { Title = "Fotoğraf seç", SelectionLimit = 1 }));
        return Wrap(files?.FirstOrDefault());
    }

    private static PickedPhoto? Wrap(FileResult? file) =>
        file is null ? null : new PickedPhoto(file.FileName, file.ContentType, _ => file.OpenReadAsync());
}
