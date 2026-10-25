using System.Globalization;
using System.Net.Http.Headers;
using Patika.App.Core.Api;
using Patika.Contracts.Media;

namespace Patika.App.Core.Media;

/// <summary>
/// <see cref="IPhotoUploader"/> over the API's presigned PUT. The PUT goes straight to object storage on
/// <paramref name="storage"/>, a separate client without the API's token, and carries exactly the
/// presigned <c>Content-Type</c> and <c>Content-Length</c>; the storage rejects anything else. The presigned
/// address must be on one of the configured <paramref name="origins"/>, and <paramref name="storage"/> must not
/// follow redirects (use <see cref="StorageOrigins.CreateClient"/>), so a wrong or hostile answer cannot send
/// the photo anywhere else, the local network included.
/// </summary>
public sealed class PhotoUploader(PatikaApiClient api, PhotoPipeline pipeline, HttpClient storage, StorageOrigins origins)
    : IPhotoUploader
{
    public Task<PreparedPhoto> PrepareAsync(PickedPhoto photo, CancellationToken ct = default) =>
        pipeline.PrepareAsync(photo, ct);

    public async Task<string> UploadAsync(PreparedPhoto photo, string kind, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(photo);
        if (!MediaKeys.IsKind(kind))
        {
            throw new ArgumentOutOfRangeException(nameof(kind), kind, "Unknown photo kind.");
        }

        // Defence in depth: the bytes were sanitized when prepared; check once more right before they leave.
        if (JpegSanitizer.Inspect(photo.Jpeg).HasMetadata || photo.Length > MediaKeys.MaxUploadBytes)
        {
            throw PhotoException.Unreadable();
        }

        var presign = await api.SendAsync<PresignUploadResponse>(HttpMethod.Post, "uploads/presign",
            new PresignUploadRequest(kind, PreparedPhoto.ContentType, photo.Length), AuthMode.Required, ct: ct)
            .ConfigureAwait(false) ?? throw BadPresign();
        var target = Validate(presign, kind, photo.Length, origins);

        using var request = new HttpRequestMessage(HttpMethod.Put, target);
        request.Content = new ByteArrayContent(photo.Jpeg);
        request.Content.Headers.ContentType = new MediaTypeHeaderValue(PreparedPhoto.ContentType);
        request.Content.Headers.ContentLength = photo.Length;
        foreach (var (name, value) in presign.Headers)
        {
            if (!name.StartsWith("Content-", StringComparison.OrdinalIgnoreCase))
            {
                request.Headers.TryAddWithoutValidation(name, value);
            }
        }

        HttpResponseMessage response;
        try
        {
            response = await storage.SendAsync(request, ct).ConfigureAwait(false);
        }
        catch (OperationCanceledException e) when (!ct.IsCancellationRequested)
        {
            throw ApiException.Network(e);
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            throw ApiException.Network(e);
        }

        using (response)
        {
            if (!response.IsSuccessStatusCode)
            {
                var status = (int)response.StatusCode;
                throw new ApiException(status >= 500 ? ApiErrorKind.Server : ApiErrorKind.Client, UploadErrors.PutFailedText,
                    status, UploadErrors.PutFailedCode);
            }
        }

        return presign.Key;
    }

    /// <summary>The presign must be a PUT for this kind with the very headers this upload will send.</summary>
    private static Uri Validate(PresignUploadResponse presign, string kind, long length, StorageOrigins origins)
    {
        var headers = new Dictionary<string, string>(presign.Headers, StringComparer.OrdinalIgnoreCase);
        var ok = string.Equals(presign.Method, "PUT", StringComparison.OrdinalIgnoreCase)
            && MediaKeys.TryParse(presign.Key, out var keyKind, out _) && keyKind == kind
            && headers.TryGetValue("Content-Type", out var type) && type == PreparedPhoto.ContentType
            && headers.TryGetValue("Content-Length", out var size)
            && size == length.ToString(CultureInfo.InvariantCulture)
            && Uri.TryCreate(presign.UploadUrl, UriKind.Absolute, out var target)
            && origins.Allows(target);
        return ok ? new Uri(presign.UploadUrl) : throw BadPresign();
    }

    private static ApiException BadPresign() =>
        new(ApiErrorKind.Server, UploadErrors.PutFailedText, code: UploadErrors.BadPresignCode);
}
