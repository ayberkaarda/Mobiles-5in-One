using Patika.App.Core.Api;
using Patika.App.Core.Media;
using Patika.App.ViewModels.Urgent;

namespace Patika.App.Pages.Urgent;

/// <summary>
/// The urgent form's photo: camera (gallery when there is no camera), then the shared pipeline strips all
/// metadata on the phone and uploads it as an <c>urgent</c> photo. The preview shows the sanitized bytes.
/// </summary>
public sealed class UrgentPhotoFlow(IPhotoPicker picker, IPhotoUploader uploader, UrgentPreviewFiles previews) : IUrgentPhotoFlow
{
    public async Task<UrgentPhoto?> CaptureAsync(CancellationToken ct = default)
    {
        var picked = picker.CanCapture ? await picker.CaptureAsync(ct) : await picker.PickAsync(ct);
        if (picked is null)
        {
            return null;
        }

        try
        {
            var prepared = await uploader.PrepareAsync(picked, ct);
            var key = await uploader.UploadAsync(prepared, "urgent", ct);
            var preview = previews.NewPath();
            await File.WriteAllBytesAsync(preview, prepared.Jpeg, ct);
            return new UrgentPhoto(key, preview);
        }
        catch (PhotoException e)
        {
            throw new ApiException(ApiErrorKind.Client, e.Message, inner: e);
        }
    }
}
