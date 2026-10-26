namespace Patika.Contracts.Auth;

public sealed record TotpCodeRequest(string Code);
public sealed record TotpEnrolResponse(string OtpauthUri, string Secret);
public sealed record TotpConfirmResponse(IReadOnlyList<string> RecoveryCodes);
public sealed record MfaRequiredResponse(bool MfaRequired, string MfaToken);
public sealed record MfaRequest(string MfaToken, string? Code = null, string? RecoveryCode = null);
