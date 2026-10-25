using Patika.App.Core.Api;
using Patika.App.Core.Map;
using Patika.Contracts.Community;
using Patika.Contracts.Geo;
using Xunit;

namespace Patika.App.Tests.Stations;

public sealed class StationSubmissionTests
{
    private readonly List<(StationRequest Body, string Key)> sent = [];
    private readonly Queue<Exception?> answers = new();

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private static StationRequest Form(double lat, string kind = "Food", string? name = null) =>
        new(new CoordinateDto(lat, 29.02), kind, "Cat", "station/0199f000-0000-7000-8000-000000000001", name);

    private Task<StationResponse> Send(StationRequest body, string key, CancellationToken ct)
    {
        sent.Add((body, key));
        if (answers.Count > 0 && answers.Dequeue() is { } failure)
        {
            throw failure;
        }

        return Task.FromResult(new StationResponse(Guid.NewGuid(), body.Name, body.Location, body.Kind, body.Species, body.PhotoKey,
            "Active", null, 0));
    }

    [Fact]
    public async Task After_a_lost_answer_a_moved_pin_does_not_change_the_body_sent_under_that_key()
    {
        var submission = new StationSubmission();
        answers.Enqueue(ApiException.Network(new HttpRequestException("lost")));

        await Assert.ThrowsAsync<ApiException>(() => submission.SubmitAsync(Form(40.9800), Send, Ct));
        Assert.Equal(Form(40.9800), submission.Unresolved);

        // The user drags the pin and renames it, then retries: the first body goes again, same key.
        var created = await submission.SubmitAsync(Form(40.9900, "Water", "Yeni ad"), Send, Ct);

        Assert.Equal(2, sent.Count);
        Assert.Equal(sent[0].Key, sent[1].Key);
        Assert.Equal(sent[0].Body, sent[1].Body);
        Assert.Equal(40.98, created.Location.Latitude);
        Assert.Null(submission.Unresolved);

        // Resolved: the next station is a new request with a new key.
        await submission.SubmitAsync(Form(40.9900, "Water"), Send, Ct);
        Assert.NotEqual(sent[0].Key, sent[2].Key);
        Assert.Equal(40.99, sent[2].Body.Location.Latitude);
    }

    [Theory]
    [InlineData(503)]
    [InlineData(429)]
    public async Task Server_errors_and_throttling_also_keep_body_and_key_together(int status)
    {
        var submission = new StationSubmission();
        answers.Enqueue(new ApiException(status >= 500 ? ApiErrorKind.Server : ApiErrorKind.Client, "x", status));

        await Assert.ThrowsAsync<ApiException>(() => submission.SubmitAsync(Form(40.98), Send, Ct));
        await submission.SubmitAsync(Form(40.97), Send, Ct);

        Assert.Equal(sent[0], sent[1]);
    }

    [Fact]
    public async Task A_final_refusal_releases_the_key_so_the_corrected_form_is_a_new_request()
    {
        var submission = new StationSubmission();
        answers.Enqueue(new ApiException(ApiErrorKind.Client, "invalid", 400, ErrorCodes.ValidationFailed));

        await Assert.ThrowsAsync<ApiException>(() => submission.SubmitAsync(Form(40.98, name: new string('a', 300)), Send, Ct));
        Assert.Null(submission.Unresolved);
        await submission.SubmitAsync(Form(40.98, name: "Köşe"), Send, Ct);

        Assert.NotEqual(sent[0].Key, sent[1].Key);
        Assert.Equal("Köşe", sent[1].Body.Name);
    }
}
