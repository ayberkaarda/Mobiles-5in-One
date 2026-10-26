namespace Patika.Contracts;

/// <summary>
/// Marks a request string that must reach the server byte for byte: a password or an opaque credential or token.
/// Every other string property of a request contract is cleaned with <c>UserText.Clean</c> before validation.
/// Use it as <c>[property: Verbatim]</c> on positional records. The list of marked properties is pinned by a test.
/// </summary>
[AttributeUsage(AttributeTargets.Property, Inherited = true)]
public sealed class VerbatimAttribute : Attribute;
