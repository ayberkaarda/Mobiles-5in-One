<?php

namespace Askida\PHPStan\Rules;

use PhpParser\Node;
use PhpParser\Node\Expr;
use PhpParser\Node\Expr\BinaryOp\Concat;
use PhpParser\Node\Expr\CallLike;
use PhpParser\Node\Expr\ClassConstFetch;
use PhpParser\Node\Expr\ConstFetch;
use PhpParser\Node\Expr\MethodCall;
use PhpParser\Node\Expr\NullsafeMethodCall;
use PhpParser\Node\Expr\StaticCall;
use PhpParser\Node\Identifier;
use PhpParser\Node\Scalar\Float_;
use PhpParser\Node\Scalar\Int_;
use PhpParser\Node\Scalar\InterpolatedString;
use PhpParser\Node\Scalar\String_;
use PHPStan\Analyser\Scope;
use PHPStan\Rules\Rule;
use PHPStan\Rules\RuleErrorBuilder;

/**
 * Security checklist item 15: the SQL string handed to a raw query method must not be
 * built with string interpolation or concatenation of non-literal parts. Values go in
 * as bindings (`whereRaw('a = ?', [$value])`).
 *
 * The check looks at the first argument expression itself. A string assembled earlier
 * in a variable is not traced; code review and the binding convention cover that case.
 *
 * @implements Rule<CallLike>
 */
final class NoInterpolatedRawSqlRule implements Rule
{
    public const IDENTIFIER = 'askida.rawSqlInterpolation';

    /** @var list<string> lower-case method names */
    private const METHODS = [
        'raw',
        'whereraw',
        'orwhereraw',
        'selectraw',
        'orderbyraw',
        'groupbyraw',
        'havingraw',
        'orhavingraw',
        'statement',
        'unprepared',
        'fromraw',
        'joinraw',
    ];

    public function getNodeType(): string
    {
        return CallLike::class;
    }

    public function processNode(Node $node, Scope $scope): array
    {
        if (! $node instanceof MethodCall && ! $node instanceof NullsafeMethodCall && ! $node instanceof StaticCall) {
            return [];
        }

        if (! $node->name instanceof Identifier || ! in_array($node->name->toLowerString(), self::METHODS, true)) {
            return [];
        }

        if ($node->isFirstClassCallable()) {
            return [];
        }

        $args = $node->getArgs();

        if ($args === [] || ! self::isBuiltFromVariables($args[0]->value)) {
            return [];
        }

        return [
            RuleErrorBuilder::message(sprintf(
                'Raw SQL passed to %s() is built with interpolation or concatenation; use bound parameters instead.',
                $node->name->toString(),
            ))->identifier(self::IDENTIFIER)->build(),
        ];
    }

    private static function isBuiltFromVariables(Expr $expr): bool
    {
        if ($expr instanceof InterpolatedString) {
            return true;
        }

        if ($expr instanceof Concat) {
            return ! self::isLiteral($expr->left) || ! self::isLiteral($expr->right);
        }

        return false;
    }

    private static function isLiteral(Expr $expr): bool
    {
        return match (true) {
            $expr instanceof String_, $expr instanceof Int_, $expr instanceof Float_ => true,
            $expr instanceof ClassConstFetch, $expr instanceof ConstFetch => true,
            $expr instanceof Concat => self::isLiteral($expr->left) && self::isLiteral($expr->right),
            default => false,
        };
    }
}
