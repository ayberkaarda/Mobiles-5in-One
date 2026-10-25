namespace Patika.Web.Services;

/// <summary>
/// Output cache lifetimes for pages whose rows moderation in the API can withdraw. Everything else uses
/// the five-minute base policy.
/// </summary>
public static class CachePolicies
{
    /// <summary>60 seconds: one adoption post.</summary>
    public const string AdoptionDetail = "adoption-detail";

    /// <summary>2 minutes: pages listing adoption posts or care places, and a care place itself.</summary>
    public const string Listing = "listing";
}
