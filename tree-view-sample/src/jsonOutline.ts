import * as vscode from 'vscode';
import * as json from 'jsonc-parser';
import * as path from 'path';


export class JsonOutlineProvider implements vscode.TreeDataProvider<number> {

	private _onDidChangeTreeData: vscode.EventEmitter<number | null> = new vscode.EventEmitter<number | null>();
	readonly onDidChangeTreeData: vscode.Event<number | null> = this._onDidChangeTreeData.event;

	private tree: json.Node;
	private text: string;
	private editor: vscode.TextEditor;
	private autoRefresh = true;

	constructor(private context: vscode.ExtensionContext) {
		// 写好一个  view 的 Provider 需要注意几点：
		// 1. 与 View 交互：
		// 		用 onDidChangeTreeData 向 view 发消息，因为继承自 XXXProvider，能够挂上某个 View
		// 		实现 getChildren、getTreeItem 等方法为 view 提供数据
		// 2. 与 window、worksapce 等交互
		// 		实现并挂载相应的 onXXX 事件
		// 3. 与文件交互：
		// 		在 1、2 的实现函数中把文件及其内容也处理好。

		/**
		 * js/ts 的 onXXX 很颠覆我的理解
		 * 从 qt、mfc 等过来的经验让我觉得应该是个函数指针，所以应该是 onXXX = someFunc()
		 * 但这里用的是 onXXX( e => somFunc(e))
		 * F12 跳转的定义可见：
		 * onXXX 其实是个 Event，Event 是个 interface，这里又会出现第2个颠覆我的地方：
		 * 从 python 过来的经验让我觉得，onXXX 应该是个 Event 接口的继承类才可以进行实例化，
		 * 但 js、ts 好像完全不需要，调用的 interface 的构造函数直接实例化一个继承类 —— 是这样么？我还没学过 ts 不敢肯定。
		 */
		vscode.window.onDidChangeActiveTextEditor(() => this.onActiveEditorChanged()); // 编辑器切换文件事件
		vscode.workspace.onDidChangeTextDocument(e => this.onDocumentChanged(e));  // 编辑器文字编辑、变化事件

		// 读取配置，并设置用户在 settings 中修改后，重新复制本地变量
		this.autoRefresh = vscode.workspace.getConfiguration('jsonOutline').get('autorefresh');
		vscode.workspace.onDidChangeConfiguration(() => {
			this.autoRefresh = vscode.workspace.getConfiguration('jsonOutline').get('autorefresh');
		});
		this.onActiveEditorChanged();
	}

	/**
	 * 更新 view 中整个或某条 item
	 * 
	 * @param offset json 元素在文件中字符偏移量 —— 还没搞懂谁送进来的？是怎么送进来的？
	 */
	refresh(offset?: number): void {
		this.parseTree();
		if (offset) {
			this._onDidChangeTreeData.fire(offset);
		} else {
			this._onDidChangeTreeData.fire(undefined);
		}
	}

	// view 中右键 rename，执行 rename 命令：package.josn 中定义
	// rename 命令关联到这里的 rename 函数：extension.ts 中定义
	// 会修改 json 中对应的节点内容。
	rename(offset: number): void {
		vscode.window.showInputBox({ placeHolder: 'Enter the new label' })
			.then(value => {
				if (value !== null && value !== undefined) {
					this.editor.edit(editBuilder => {
						const path = json.getLocation(this.text, offset).path;
						let propertyNode = json.findNodeAtLocation(this.tree, path);
						if (propertyNode.parent.type !== 'array') {
							propertyNode = propertyNode.parent.children[0];
						}
						const range = new vscode.Range(this.editor.document.positionAt(propertyNode.offset), this.editor.document.positionAt(propertyNode.offset + propertyNode.length));
						editBuilder.replace(range, `"${value}"`);
						setTimeout(() => {
							this.parseTree();
							this.refresh(offset); // 更新指定
						}, 100);
					});
				}
			});
	}

	// 当 editor 中打开的是 json 文件时，将 jsonOutlineEnabled 上下文设置为 true，否则为 false
	// 以此来控制整个 view 是否显示
	// 上下文用在 package.json 的 when 中
	// 效果就是当 jsonOutlineEnabled === true 时才显示本 view
	private onActiveEditorChanged(): void {
		if (vscode.window.activeTextEditor) {
			if (vscode.window.activeTextEditor.document.uri.scheme === 'file') {
				const enabled = vscode.window.activeTextEditor.document.languageId === 'json' || vscode.window.activeTextEditor.document.languageId === 'jsonc';
				vscode.commands.executeCommand('setContext', 'jsonOutlineEnabled', enabled);
				if (enabled) {
					this.refresh();
				}
			}
		} else {
			vscode.commands.executeCommand('setContext', 'jsonOutlineEnabled', false);
		}
	}

	/** 
	 * 
	*/
	private onDocumentChanged(changeEvent: vscode.TextDocumentChangeEvent): void {
		if (this.autoRefresh && changeEvent.document.uri.toString() === this.editor.document.uri.toString()) {
			for (const change of changeEvent.contentChanges) {
				const path = json.getLocation(this.text, this.editor.document.offsetAt(change.range.start)).path;
				path.pop();
				const node = path.length ? json.findNodeAtLocation(this.tree, path) : void 0;
				this.parseTree();
				this._onDidChangeTreeData.fire(node ? node.offset : void 0);
			}
		}
	}

	private parseTree(): void {
		this.text = '';
		this.tree = null;
		this.editor = vscode.window.activeTextEditor;
		if (this.editor && this.editor.document) {
			this.text = this.editor.document.getText();
			this.tree = json.parseTree(this.text);
		}
	}

	/**
	 * getChildren 与 getTreeItem 的粗浅流程：
	 * 1. treeview 首先 getChildren(undefined) 找到第一级节点，返回值 <T[]> 数组每个节点绑定 T 作为id，本例 T 就是 offset
	 * 2. 遍历 <T[]> 数组，调用 getTreeItem(T)，即：把每个 offset 丢给 getTreeItem() 逐个生成节点
	 * 3. 生成的过程中定义每个 item 的 label、折叠状态、command、icon、上下文
	 * 4. View 对每个折叠状态为 Expand（即需要展开的）递归调用 1、2、3 …… 一个完整的 view 就生成了
	 * 5. 如果有 child 但折叠状态为 Collapsed 的，则当点击展开的时候递归调用 1、2、3 步骤。
	 * 
	 * @param offset 有2个方式调用本函数，及传递本入参
	 * 		1. 创建一个新 tree 时，处理 root 时调用 getChildren(undefined)
	 * 		2. getTreeItem() 得到的 node 是需要展开的，递归调用到这里
	 * @returns 不是 TreeItem，而是一个 thenable 的数组，用来遍历并继续递归的 getTreeItem 下去
	 */
	getChildren(offset?: number): Thenable<number[]> {
		if (offset) {
			const path = json.getLocation(this.text, offset).path;
			const node = json.findNodeAtLocation(this.tree, path);
			return Promise.resolve(this.getChildrenOffsets(node));
		} else {
			return Promise.resolve(this.tree ? this.getChildrenOffsets(this.tree) : []);
		}
	}

	private getChildrenOffsets(node: json.Node): number[] {
		const offsets: number[] = [];
		for (const child of node.children) {
			const childPath = json.getLocation(this.text, child.offset).path;
			const childNode = json.findNodeAtLocation(this.tree, childPath);
			if (childNode) {
				offsets.push(childNode.offset);
			}
		}
		return offsets; // 这里交给 treeview 的 offsets 数组，可以看做 view 中每个 item 的 id，会传递回多个回调函数
	}

	/**
	 * 创建一个 item，返回值是 TreeItem
	 * @param offset 有2个途径传进来这个参数：
	 * 	  1. getChildren 返回值是个 Thenable<T[]>，vscode 会遍历 T[] 调用 getTreeItem(T)
	 * 	  2. 从注册的 command 那边调用过来的 refresh(), rename() 中的 _onDidChangeTreeData.fire(offset) 也会让 vscode 调用 getTreeItem(offset)
	 * @returns 
	 */
	getTreeItem(offset: number): vscode.TreeItem {
		const path = json.getLocation(this.text, offset).path;
		const valueNode = json.findNodeAtLocation(this.tree, path);
		if (valueNode) {
			const hasChildren = valueNode.type === 'object' || valueNode.type === 'array';

			// 创建 item，label 是显示文字，是否折叠：如果没有 children 则为 none，有 children 如果是 object 则展开，否则折叠
			// valueNode.type：
			//  string：
			//  array：[...] 方括号定义的
			// 	object：{...} 大括号定义的
			const treeItem: vscode.TreeItem = new vscode.TreeItem(this.getLabel(valueNode),
				hasChildren ?
					// 有 children 还要再看是否是 object，object 就展开，array 折叠
					valueNode.type === 'object' ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed :
					vscode.TreeItemCollapsibleState.None); // 没有 children 就没有折叠属性
			treeItem.command = {
				command: 'extension.openJsonSelection',
				title: '',
				arguments: [new vscode.Range(this.editor.document.positionAt(valueNode.offset), this.editor.document.positionAt(valueNode.offset + valueNode.length))]
			};
			treeItem.iconPath = this.getIcon(valueNode);
			treeItem.contextValue = valueNode.type;
			return treeItem;
		}
		return null;
	}

	select(range: vscode.Range) {
		this.editor.selection = new vscode.Selection(range.start, range.end);
	}

	private getIcon(node: json.Node): any {
		const nodeType = node.type;
		if (nodeType === 'boolean') {
			return {
				light: this.context.asAbsolutePath(path.join('resources', 'light', 'boolean.svg')),
				dark: this.context.asAbsolutePath(path.join('resources', 'dark', 'boolean.svg'))
			};
		}
		if (nodeType === 'string') {
			return {
				light: this.context.asAbsolutePath(path.join('resources', 'light', 'string.svg')),
				dark: this.context.asAbsolutePath(path.join('resources', 'dark', 'string.svg'))
			};
		}
		if (nodeType === 'number') {
			return {
				light: this.context.asAbsolutePath(path.join('resources', 'light', 'number.svg')),
				dark: this.context.asAbsolutePath(path.join('resources', 'dark', 'number.svg'))
			};
		}
		return null;
	}

	private getLabel(node: json.Node): string {
		if (node.parent.type === 'array') {
			const prefix = node.parent.children.indexOf(node).toString();
			if (node.type === 'object') {
				return prefix + ':{ }';
			}
			if (node.type === 'array') {
				return prefix + ':[ ]';
			}
			return prefix + ':' + node.value.toString();
		}
		else {
			const property = node.parent.children[0].value.toString();
			if (node.type === 'array' || node.type === 'object') {
				if (node.type === 'object') {
					return '{ } ' + property;
				}
				if (node.type === 'array') {
					return '[ ] ' + property;
				}
			}
			const value = this.editor.document.getText(new vscode.Range(this.editor.document.positionAt(node.offset), this.editor.document.positionAt(node.offset + node.length)));
			return `${property}: ${value}`;
		}
	}
}
