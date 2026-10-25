using Amazon.Runtime;
using Amazon.S3;
using Amazon.S3.Model;
using Microsoft.Extensions.Options;
using Patika.Contracts.Media;

namespace Patika.Infrastructure.Media;

/// <summary>Rendition of a processed photo; see <see cref="MediaKeys.Rendition"/>.</summary>
public enum PhotoSize
{
    /// <summary>Full image, longest side at most 1600 px.</summary>
    Full,

    /// <summary>800 px wide, for detail screens.</summary>
    Medium,

    /// <summary>320 px wide, for lists and map callouts.</summary>
    Thumbnail,
}

/// <summary>
/// Turns a photo key (<c>{kind}/{uploadId}</c>) into an address the app can load. Only ever points at a
/// sanitized rendition under <c>media/</c>: the key is parsed strictly, so <c>incoming/</c>,
/// <c>quarantine/</c> or any other object can never be addressed. DTO mappers call it per photo key;
/// a null or malformed key gives null.
/// </summary>
public interface IPhotoUrlResolver
{
    string? Resolve(string? photoKey, PhotoSize size = PhotoSize.Full);
}

/// <summary>
/// With <c>Storage:PublicBaseUrl</c> set (a CDN in front of the <c>media/</c> prefix only), a stable
/// <c>{base}/media/...</c> address; otherwise a SigV4 presigned GET that expires after
/// <see cref="MediaSettings.PhotoUrlMinutes"/>. Presigning is local; no network call is made.
/// </summary>
public sealed class PhotoUrlResolver : IPhotoUrlResolver, IDisposable
{
    private readonly AmazonS3Client? client;
    private readonly string bucket;
    private readonly Protocol protocol;
    private readonly string? publicBaseUrl;
    private readonly TimeSpan lifetime;
    private readonly TimeProvider clock;

    public PhotoUrlResolver(IOptions<StorageSettings> storage, IOptions<MediaSettings> media, TimeProvider clock)
        : this(storage.Value, TimeSpan.FromMinutes(Math.Clamp(media.Value.PhotoUrlMinutes, 1, 24 * 60)), clock)
    {
    }

    internal PhotoUrlResolver(StorageSettings settings, TimeSpan lifetime, TimeProvider clock)
    {
        this.clock = clock;
        this.lifetime = lifetime;
        bucket = settings.Bucket;
        if (!string.IsNullOrWhiteSpace(settings.PublicBaseUrl))
        {
            var baseUri = new Uri(settings.PublicBaseUrl.Trim(), UriKind.Absolute);
            if (baseUri.Scheme != Uri.UriSchemeHttps && baseUri.Scheme != Uri.UriSchemeHttp)
            {
                throw new InvalidOperationException("Storage:PublicBaseUrl must be an http(s) address.");
            }

            publicBaseUrl = baseUri.GetLeftPart(UriPartial.Path).TrimEnd('/');
            return;
        }

        var endpoint = settings.PublicEndpoint ?? settings.Endpoint;
        if (endpoint is null || settings.AccessKey is null || settings.SecretKey is null)
        {
            // Without storage there is nothing to address; every key resolves to null.
            return;
        }

        var endpointUri = new Uri(endpoint, UriKind.Absolute);
        protocol = endpointUri.Scheme == Uri.UriSchemeHttp ? Protocol.HTTP : Protocol.HTTPS;
        client = new AmazonS3Client(new BasicAWSCredentials(settings.AccessKey, settings.SecretKey), new AmazonS3Config
        {
            ServiceURL = endpointUri.GetLeftPart(UriPartial.Authority),
            ForcePathStyle = true,
            AuthenticationRegion = settings.Region,
            UseHttp = protocol == Protocol.HTTP,
        });
    }

    public string? Resolve(string? photoKey, PhotoSize size = PhotoSize.Full)
    {
        if (!MediaKeys.TryParse(photoKey, out _, out _))
        {
            return null;
        }

        var objectKey = ObjectKey(photoKey!, size);
        if (publicBaseUrl is not null)
        {
            return $"{publicBaseUrl}/{objectKey}";
        }

        if (client is null)
        {
            return null;
        }

        return client.GetPreSignedURL(new GetPreSignedUrlRequest
        {
            BucketName = bucket,
            Key = objectKey,
            Verb = HttpVerb.GET,
            Protocol = protocol,
            Expires = (clock.GetUtcNow() + lifetime).UtcDateTime,
        });
    }

    /// <summary>The <c>media/</c> object for a parsed key; never any other prefix.</summary>
    internal static string ObjectKey(string photoKey, PhotoSize size)
    {
        var objectKey = MediaKeys.Rendition(photoKey, size switch
        {
            PhotoSize.Medium => 800,
            PhotoSize.Thumbnail => 320,
            _ => null,
        });
        return objectKey.StartsWith(MediaKeys.MediaPrefix, StringComparison.Ordinal)
            ? objectKey
            : throw new InvalidOperationException("Photo addresses must point at processed media.");
    }

    public void Dispose() => client?.Dispose();
}
